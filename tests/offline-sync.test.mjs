// Offline sync (stage 3): offline sales uploaded exactly once through the normal sale rules and stock
// ledger; conflicts kept, never dropped; price changes during the offline window; payment verification;
// permanent refusals; multiple devices; revocation; tenant isolation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const { subtle } = globalThis.crypto;
let server;
let admin;
let cashier;
let device;
let catalogue;

before(async () => {
  server = await startServer();
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
  cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
  device = await register(cashier, "Lekki till");
  catalogue = (await signedPost(cashier, device, "/api/offline/package")).data;
});
after(async () => {
  if (process.env.SHOW_LOGS) console.log(server?.logs().split("\n").filter((line) => /error|Error|fail/i.test(line)).slice(0, 40).join("\n"));
  await server?.stop();
});

async function register(client, name) {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKey = Buffer.from(await subtle.exportKey("spki", pair.publicKey)).toString("base64");
  const response = await client.post("/api/offline/devices", { name, outletId: "outlet-1", publicKey });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return { id: response.data.id, key: pair.privateKey };
}

async function signedPost(client, dev, path, body = {}) {
  const time = new Date().toISOString();
  const signature = Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, dev.key, new TextEncoder().encode(`${dev.id}.${time}.POST.${path}`))).toString("base64");
  const response = await fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { cookie: client.cookieHeader(), "Content-Type": "application/json", "X-Device-Id": dev.id, "X-Device-Time": time, "X-Device-Signature": signature }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}

const round2 = (value) => Math.round(value * 100) / 100;
const vatRate = () => catalogue.settings.vatRate;

/** A sellable product with stock on the device, and its base package. */
function stocked(minUnits = 3) {
  const usable = new Map();
  for (const batch of catalogue.batches) if (!batch.blocked) usable.set(batch.productId, (usable.get(batch.productId) ?? 0) + batch.availableQuantity);
  const product = catalogue.products.find((row) => (usable.get(row.id) ?? 0) >= minUnits && row.lifecycle === "ACTIVE" && row.status !== "RESTRICTED" && !row.rxOnly && row.packaging.some((level) => level.isBase && level.sellable));
  assert.ok(product, "a stocked product exists at outlet-1");
  const level = product.packaging.find((row) => row.isBase);
  return { product, level, price: level.sellingPrice ?? product.sellingPrice, units: usable.get(product.id) };
}

function saleOperation({ product, level, price }, { quantity = 1, payments, packPrice = price, discount, total, createdAt = new Date().toISOString(), id = randomUUID() } = {}) {
  const subtotal = round2(packPrice * quantity);
  const discountValue = discount ? round2((subtotal * discount.value) / 100) : 0;
  const vat = Math.round((subtotal - discountValue) * (vatRate() / 100));
  const due = total ?? round2(subtotal - discountValue + vat);
  return {
    id,
    type: "sale",
    createdAt,
    payload: {
      localNumber: `OFF-TEST-${id.slice(0, 4)}`,
      outletId: "outlet-1",
      customerId: null,
      lines: [{ productId: product.id, productName: product.name, packagingId: level.id, quantity, packPrice, discount }],
      payments: payments ?? [{ method: "Cash", amount: due }],
      totals: { subtotal, discount: discountValue, vat, total: due },
    },
  };
}

const upload = (operation, dev = device, client = cashier) => signedPost(client, dev, "/api/offline/sync", { operation });
const stockOf = async (productId) => (await server.query("SELECT stock FROM products WHERE id = ?", productId))[0].stock;
const salesFor = async (operationId) => (await server.query("SELECT id, number, total, offline FROM sales WHERE offline::jsonb->>'operationId' = ?", operationId)).map((row) => ({ ...row, offline: JSON.parse(row.offline) }));

async function assertLedgerHealthy() {
  const verify = await admin.get("/api/stock-ledger?verify=1");
  assert.deepEqual(verify.data.mismatches, [], "cached balances match the ledger");
}

describe("Offline sales", () => {
  test("an offline cash sale is posted once, with its offline time, through the stock ledger", async () => {
    const item = stocked();
    const before = await stockOf(item.product.id);
    const soldAt = new Date(Date.now() - 2_000).toISOString();
    const operation = saleOperation(item, { quantity: 2, createdAt: soldAt });
    const result = await upload(operation);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.status, "applied");
    assert.match(result.data.serverRef.number, /^INV-/);
    const [sale] = await salesFor(operation.id);
    assert.equal(sale.number, result.data.serverRef.number);
    assert.equal(sale.offline.localNumber, operation.payload.localNumber);
    assert.equal(sale.offline.deviceId, device.id);
    assert.equal(Number(sale.total), operation.payload.totals.total);
    const [row] = await server.query("SELECT date FROM sales WHERE id = ?", sale.id);
    assert.equal(row.date, soldAt, "the sale keeps the time it was made");
    assert.equal(await stockOf(item.product.id), before - 2);
    await assertLedgerHealthy();
  });

  test("uploading the same operation again, even in parallel, never creates a second sale", async () => {
    const operation = saleOperation(stocked());
    const results = await Promise.all([upload(operation), upload(operation), upload(operation)]);
    assert.deepEqual(results.map((result) => result.status), [200, 200, 200]);
    assert.equal(results.filter((result) => result.data.status === "applied").length, 1);
    for (const result of results.filter((entry) => entry.data.status === "duplicate")) assert.equal(result.data.original, "applied");
    assert.equal((await salesFor(operation.id)).length, 1);
    const [{ attempts }] = await server.query("SELECT attempts FROM offline_operations WHERE id = ?", operation.id);
    assert.equal(attempts, 3);
  });

  test("card and transfer payments recorded offline are flagged for verification", async () => {
    const item = stocked();
    const draft = saleOperation(item);
    const operation = saleOperation(item, { payments: [{ method: "Card", amount: draft.payload.totals.total, reference: "TERM-778" }] });
    const result = await upload(operation);
    assert.equal(result.data.status, "applied", JSON.stringify(result.data));
    const [sale] = await salesFor(operation.id);
    assert.deepEqual(sale.offline.unverifiedTenders, [{ method: "Card", amount: operation.payload.totals.total, reference: "TERM-778" }]);
    const notes = await server.query("SELECT title FROM notifications WHERE title = 'Offline card/transfer payment to verify'");
    assert.ok(notes.length > 0, "stock approvers are told");
  });

  test("a sale at a price the item had before a price change is accepted at that price", async () => {
    const item = stocked();
    const oldPrice = item.price;
    const changed = await admin.patch(`/api/products/${item.product.id}`, { pricing: { sellingPrice: round2(oldPrice + 7) } });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    const operation = saleOperation(item, { packPrice: oldPrice, createdAt: new Date(Date.now() - 60_000).toISOString() });
    const result = await upload(operation);
    assert.equal(result.data.status, "applied", JSON.stringify(result.data));
    const [line] = await server.query("SELECT pack_price FROM sale_lines WHERE sale_id = (SELECT id FROM sales WHERE offline::jsonb->>'operationId' = ?)", operation.id);
    assert.equal(Number(line.pack_price), oldPrice, "the price the customer paid");
  });
});

describe("Conflicts and refusals are kept, never dropped", () => {
  test("a price the item never had is a conflict for reconciliation, and managers are told", async () => {
    const item = stocked();
    const operation = saleOperation(item, { packPrice: 0.5 });
    const result = await upload(operation);
    assert.equal(result.data.status, "conflict");
    assert.match(result.data.message, /not a price it had/);
    const [row] = await server.query("SELECT status, payload FROM offline_operations WHERE id = ?", operation.id);
    assert.equal(row.status, "CONFLICT");
    assert.equal(row.payload.localNumber, operation.payload.localNumber, "the full sale is preserved");
    assert.equal((await salesFor(operation.id)).length, 0);
    assert.ok((await server.query("SELECT 1 FROM notifications WHERE title = 'Offline record needs reconciliation'")).length > 0);
  });

  test("selling more than the stock left (another till sold it) is a stock conflict; balances stay correct", async () => {
    const item = stocked();
    const before = await stockOf(item.product.id);
    const operation = saleOperation(item, { quantity: before + 5 });
    const result = await upload(operation);
    assert.equal(result.data.status, "conflict");
    assert.match(result.data.message, /Not enough usable stock/);
    assert.equal(await stockOf(item.product.id), before, "no negative or overwritten stock");
    await assertLedgerHealthy();
  });

  test("totals that do not follow from the prices are a conflict", async () => {
    const operation = saleOperation(stocked(), { total: 1 });
    assert.equal((await upload(operation)).data.status, "conflict");
  });

  test("business-rule refusals are permanent (not retried) and kept", async () => {
    const operation = saleOperation(stocked(), { discount: { type: "percent", value: 60 } });
    const result = await upload(operation);
    assert.equal(result.data.status, "rejected");
    assert.match(result.data.message, /Discounts are limited|discount/i);
    const [row] = await server.query("SELECT status FROM offline_operations WHERE id = ?", operation.id);
    assert.equal(row.status, "REJECTED");
  });

  test("malformed uploads and impossible times are refused", async () => {
    const bad = await upload({ id: "not-a-uuid", type: "sale", createdAt: new Date().toISOString(), payload: {} });
    assert.equal(bad.status, 422);
    const future = saleOperation(stocked(), { createdAt: new Date(Date.now() + 3_600_000).toISOString() });
    const result = await upload(future);
    assert.equal(result.data.status, "rejected");
    assert.match(result.data.message, /impossible time/);
  });
});

describe("Several devices", () => {
  test("two offline tills and the online till all keep their sales; stock stays consistent", async () => {
    const second = await register(cashier, "Lekki till 2");
    const item = stocked(4);
    const before = await stockOf(item.product.id);
    const online = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: null, lines: [{ productId: item.product.id, quantity: 1, packagingId: item.level.id }], payments: [{ method: "Cash", amount: 100000 }] });
    assert.equal(online.status, 201, JSON.stringify(online.data));
    const [a, b] = await Promise.all([upload(saleOperation(item)), upload(saleOperation(item), second)]);
    assert.deepEqual([a.data.status, b.data.status], ["applied", "applied"]);
    assert.equal(await stockOf(item.product.id), before - 3);
    await assertLedgerHealthy();
  });

  test("an operation ID cannot be reused by another device", async () => {
    const other = await register(cashier, "Lekki till 3");
    const operation = saleOperation(stocked());
    assert.equal((await upload(operation)).data.status, "applied");
    const reuse = await upload(operation, other);
    assert.equal(reuse.status, 409);
  });

  test("a revoked device cannot upload", async () => {
    const lost = await register(cashier, "Lost tablet");
    await admin.patch(`/api/offline/devices/${lost.id}`, { revoke: true, reason: "Lost" });
    assert.equal((await upload(saleOperation(stocked()), lost)).status, 410);
  });
});

describe("Tenant isolation", () => {
  test("offline operations are stored per pharmacy with Row Level Security", async () => {
    const [row] = await server.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'offline_operations'");
    assert.deepEqual(row, { relrowsecurity: true, relforcerowsecurity: true });
    const tenants = await server.query("SELECT DISTINCT tenant_id FROM offline_operations");
    assert.deepEqual(tenants.map((entry) => entry.tenant_id), ["tenant-demo"]);
  });
});
