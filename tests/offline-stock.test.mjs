// Offline inventory (stage 4): products, stock receipts and adjustments made offline, dependencies between
// them, and the reconciliation centre (retry, close, payment checks), with outlet scoping.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const { subtle } = globalThis.crypto;
let server;
let admin;
let cashier;
let keeper; // stock manager at outlet-1
let tillDevice;
let stockDevice;
let catalogue;

before(async () => {
  server = await startServer();
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
  cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
  keeper = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
  tillDevice = await register(cashier, "Till");
  stockDevice = await register(keeper, "Store room tablet");
  catalogue = (await signed(keeper, stockDevice, "/api/offline/package")).data;
});
after(async () => {
  await server?.stop();
});

async function register(client, name) {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKey = Buffer.from(await subtle.exportKey("spki", pair.publicKey)).toString("base64");
  const response = await client.post("/api/offline/devices", { name, outletId: "outlet-1", publicKey });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return { id: response.data.id, key: pair.privateKey };
}
async function signed(client, device, path, body = {}) {
  const time = new Date().toISOString();
  const signature = Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, device.key, new TextEncoder().encode(`${device.id}.${time}.POST.${path}`))).toString("base64");
  const response = await fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { cookie: client.cookieHeader(), "Content-Type": "application/json", "X-Device-Id": device.id, "X-Device-Time": time, "X-Device-Signature": signature }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const upload = (client, device, type, payload, id = randomUUID()) => signed(client, device, "/api/offline/sync", { operation: { id, type, createdAt: new Date().toISOString(), payload } });
const days = (count) => new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);
const supplier = () => catalogue.suppliers[0];
const stockOf = async (productId) => (await server.query("SELECT stock FROM products WHERE id = ?", productId))[0].stock;
async function assertLedgerHealthy() {
  assert.deepEqual((await admin.get("/api/stock-ledger?verify=1")).data.mismatches, []);
}

describe("Offline products and receipts", () => {
  let productOp;
  test("a product registered offline is created through the normal registration", async () => {
    productOp = randomUUID();
    const result = await upload(keeper, stockDevice, "product", { localNumber: "OPR-T-0001", name: "Offlinex 20mg Tablets", category: "Analgesics", strength: "20mg", packaging: [{ name: "Pack", contains: 10 }, { name: "Tablet", contains: 1 }], purchasePrice: 4, sellingPrice: 6 }, productOp);
    assert.equal(result.data.status, "applied", JSON.stringify(result.data));
    const [row] = await server.query("SELECT id, outlet_id FROM products WHERE name = 'Offlinex 20mg Tablets'");
    assert.equal(result.data.serverRef.productId, row.id);
    assert.equal(row.outlet_id, "outlet-1");
  });

  test("a receipt for that product (made offline before it existed) lands as its own batch through the ledger", async () => {
    assert.ok(supplier(), "an approved supplier is in the package");
    const result = await upload(keeper, stockDevice, "receiving", { localNumber: "ORC-T-0001", productRef: productOp, productName: "Offlinex 20mg Tablets", supplierId: supplier().id, quantity: 3, packagingName: "Pack", unitCost: 40, batchNumber: "OFX-1", manufacturingDate: days(-20), expiryDate: days(700), invoiceNumber: "INV-778" });
    assert.equal(result.data.status, "applied", JSON.stringify(result.data));
    const productId = result.data.serverRef.productId;
    assert.equal(await stockOf(productId), 30, "3 packs × 10 tablets");
    const [batch] = await server.query("SELECT batch_number, available_quantity FROM batches WHERE product_id = ?", productId);
    assert.deepEqual(batch, { batch_number: "OFX-1", available_quantity: 30 });
    const [movement] = await server.query("SELECT reason FROM stock_movements WHERE id = ?", result.data.serverRef.movementId);
    assert.match(movement.reason, /Received offline on “Store room tablet”/);
    await assertLedgerHealthy();
  });

  test("the same batch received twice is a conflict; short-dated stock is refused", async () => {
    const productId = (await server.query("SELECT id FROM products WHERE name = 'Offlinex 20mg Tablets'"))[0].id;
    const again = await upload(keeper, stockDevice, "receiving", { localNumber: "ORC-T-0002", productId, productName: "Offlinex", supplierId: supplier().id, quantity: 1, packagingName: "Pack", unitCost: 40, batchNumber: "OFX-1", manufacturingDate: days(-20), expiryDate: days(700) });
    assert.equal(again.data.status, "conflict");
    const short = await upload(keeper, stockDevice, "receiving", { localNumber: "ORC-T-0003", productId, productName: "Offlinex", supplierId: supplier().id, quantity: 1, packagingName: "Pack", unitCost: 40, batchNumber: "OFX-2", manufacturingDate: days(-20), expiryDate: days(10) });
    assert.equal(short.data.status, "rejected");
    assert.match(short.data.message, /Short-dated/);
  });

  test("a receipt depending on a product that could not be created is kept as a conflict", async () => {
    const dup = randomUUID();
    const product = await upload(keeper, stockDevice, "product", { localNumber: "OPR-T-0002", name: "Offlinex 20mg Tablets", category: "Analgesics", packaging: [{ name: "Tablet", contains: 1 }], purchasePrice: 4, sellingPrice: 6 }, dup);
    assert.equal(product.data.status, "conflict", "already registered meanwhile");
    const receipt = await upload(keeper, stockDevice, "receiving", { localNumber: "ORC-T-0004", productRef: dup, productName: "Offlinex dup", supplierId: supplier().id, quantity: 1, packagingName: "Tablet", unitCost: 4, batchNumber: "D-1", manufacturingDate: days(-5), expiryDate: days(500) });
    assert.equal(receipt.data.status, "conflict");
    assert.match(receipt.data.message, /has not been created/);
  });
});

describe("Offline adjustments", () => {
  test("become the normal approval request; a cashier without the right is refused", async () => {
    const productId = (await server.query("SELECT id FROM products WHERE name = 'Offlinex 20mg Tablets'"))[0].id;
    const result = await upload(keeper, stockDevice, "adjustment", { localNumber: "OAD-T-0001", productId, productName: "Offlinex", direction: "OUT", quantity: 2, reason: "Broken pack" });
    assert.equal(result.data.status, "applied", JSON.stringify(result.data));
    const [movement] = await server.query("SELECT status, reason FROM stock_movements WHERE id = ?", result.data.serverRef.movementId);
    assert.notEqual(movement.status, "Approved", "waits for an approver, as online");
    assert.match(movement.reason, /recorded offline/);
    assert.equal(await stockOf(productId), 30, "nothing moves until approved");
    assert.equal((await admin.patch(`/api/inventory/${result.data.serverRef.movementId}`, { status: "Approved" })).status, 200);
    assert.equal(await stockOf(productId), 28);
    const refused = await upload(cashier, tillDevice, "adjustment", { localNumber: "OAD-T-0002", productId, productName: "Offlinex", direction: "OUT", quantity: 1, reason: "Counted short" });
    assert.equal(refused.data.status, "rejected");
    await assertLedgerHealthy();
  });
});

describe("Reconciliation centre", () => {
  let conflictId;
  let product;
  let pkg;
  before(async () => {
    pkg = (await signed(cashier, tillDevice, "/api/offline/package")).data;
    product = pkg.products.find((row) => row.name === "Offlinex 20mg Tablets");
  });

  function sale(quantity) {
    const level = product.packaging.find((row) => row.isBase);
    const price = level.sellingPrice ?? product.sellingPrice;
    const subtotal = Math.round(price * quantity * 100) / 100;
    const vat = Math.round(subtotal * (pkg.settings.vatRate / 100));
    return { localNumber: `OFF-T-${quantity}`, outletId: "outlet-1", lines: [{ productId: product.id, productName: product.name, packagingId: level.id, quantity, packPrice: price }], payments: [{ method: "Transfer", amount: subtotal + vat, reference: "TRF-1" }], totals: { subtotal, discount: 0, vat, total: subtotal + vat } };
  }

  test("a stock conflict is listed, can be retried after stock arrives, and posts in the cashier's name", async () => {
    conflictId = randomUUID();
    const first = await upload(cashier, tillDevice, "sale", sale(40), conflictId);
    assert.equal(first.data.status, "conflict");
    const list = await admin.get("/api/offline/operations");
    assert.equal(list.status, 200);
    const row = list.data.operations.find((entry) => entry.id === conflictId);
    assert.equal(row.status, "CONFLICT");
    assert.equal(row.deviceName, "Till");
    assert.equal((await cashier.post(`/api/offline/operations/${conflictId}`, { action: "retry" })).status, 403, "cashiers cannot resolve");
    const early = await admin.post(`/api/offline/operations/${conflictId}`, { action: "retry" });
    assert.equal(early.status, 409);
    assert.match(early.data.error, /Still cannot be applied/);
    // The missing stock is received, then the sale is retried.
    const receipt = await upload(keeper, stockDevice, "receiving", { localNumber: "ORC-T-0009", productId: product.id, productName: product.name, supplierId: supplier().id, quantity: 2, packagingName: "Pack", unitCost: 40, batchNumber: "OFX-9", manufacturingDate: days(-3), expiryDate: days(600) });
    assert.equal(receipt.data.status, "applied");
    const retried = await admin.post(`/api/offline/operations/${conflictId}`, { action: "retry" });
    assert.equal(retried.status, 200, JSON.stringify(retried.data));
    assert.equal(retried.data.status, "RESOLVED");
    const [posted] = await server.query("SELECT cashier, number FROM sales WHERE id = ?", retried.data.serverRef.saleId);
    assert.equal(posted.cashier, "Grace Udo", "in the name of the cashier who made it offline");
    const beat = await signed(cashier, tillDevice, "/api/offline/heartbeat", {});
    assert.ok(beat.data.resolved.includes(conflictId), "the device learns it was resolved");
    await assertLedgerHealthy();
  });

  test("a record can be closed with a reason; the original stays untouched", async () => {
    const id = randomUUID();
    assert.equal((await upload(cashier, tillDevice, "sale", sale(500), id)).data.status, "conflict");
    assert.equal((await admin.post(`/api/offline/operations/${id}`, { action: "close", note: "short" })).status, 400);
    const closed = await admin.post(`/api/offline/operations/${id}`, { action: "close", note: "Customer refunded at the counter; nothing dispensed." });
    assert.equal(closed.data.status, "RESOLVED");
    const [row] = await server.query("SELECT status, payload, resolution FROM offline_operations WHERE id = ?", id);
    assert.equal(row.payload.localNumber, "OFF-T-500", "original record kept");
    assert.match(row.resolution, /Closed by .* refunded/);
    assert.equal((await admin.post(`/api/offline/operations/${id}`, { action: "retry" })).status, 409, "settled once");
    const [audit] = await server.query("SELECT severity FROM audit_events WHERE action = 'offline.resolve' AND entity_id = ?", id);
    assert.equal(audit.severity, "critical");
  });

  test("offline transfer payments are confirmed once, without changing the sale", async () => {
    const list = (await admin.get("/api/offline/operations")).data;
    const payment = list.payments.find((row) => row.tenders.some((tender) => tender.reference === "TRF-1"));
    assert.ok(payment, "the retried sale's transfer awaits confirmation");
    const before = (await server.query("SELECT total, status FROM sales WHERE id = ?", payment.saleId))[0];
    const ok = await admin.post(`/api/offline/payments/${payment.saleId}`, { outcome: "verified", note: "Seen on bank statement" });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal((await admin.post(`/api/offline/payments/${payment.saleId}`, { outcome: "verified" })).status, 409);
    assert.deepEqual((await server.query("SELECT total, status FROM sales WHERE id = ?", payment.saleId))[0], before);
    assert.ok(!(await admin.get("/api/offline/operations")).data.payments.some((row) => row.saleId === payment.saleId));
  });

  test("the page is for approvers and supervisors; outlet staff see their outlet only", async () => {
    assert.equal((await admin.request("GET", "/inventory/offline", undefined, { raw: true })).status, 200);
    assert.equal((await cashier.request("GET", "/inventory/offline", undefined, { raw: true })).status, 307);
    const ikeja = await signedIn(server.baseUrl, "store@web365.ng", "outlet-2");
    const theirs = await ikeja.get("/api/offline/operations");
    assert.equal(theirs.status, 200);
    assert.deepEqual(theirs.data.operations, [], "outlet-1 records are not shown at outlet-2");
    assert.equal((await ikeja.post(`/api/offline/operations/${conflictId}`, { action: "close", note: "Not my outlet at all here" })).status, 404);
  });
});
