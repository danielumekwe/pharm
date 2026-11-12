// Offline refresh (stage 5): after the first download only changed products travel (content fingerprints of
// product details + batch stock), removed products are reported, and a dated sales snapshot is included for
// people allowed to see sales figures.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const { subtle } = globalThis.crypto;
let server;
let admin;
let cashier;

before(async () => {
  server = await startServer();
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
  cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
});
after(async () => {
  await server?.stop();
});

async function register(client) {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKey = Buffer.from(await subtle.exportKey("spki", pair.publicKey)).toString("base64");
  const response = await client.post("/api/offline/devices", { name: "Refresh test", outletId: "outlet-1", publicKey });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return { id: response.data.id, key: pair.privateKey };
}
async function pull(client, device, body = {}) {
  const path = "/api/offline/package";
  const time = new Date().toISOString();
  const signature = Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, device.key, new TextEncoder().encode(`${device.id}.${time}.POST.${path}`))).toString("base64");
  const response = await fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { cookie: client.cookieHeader(), "Content-Type": "application/json", "X-Device-Id": device.id, "X-Device-Time": time, "X-Device-Signature": signature }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
}

describe("Incremental refresh", () => {
  test("only changed products travel after the first download", async () => {
    const device = await register(cashier);
    const full = await pull(cashier, device);
    assert.equal(full.mode, "full");
    assert.ok(full.products.length > 1);
    assert.ok(full.products.every((product) => typeof product.fp === "string" && product.fp.length >= 10));
    const known = Object.fromEntries(full.products.map((product) => [product.id, product.fp]));

    const nothing = await pull(cashier, device, { known });
    assert.equal(nothing.mode, "delta");
    assert.deepEqual(nothing.products, [], "nothing changed, nothing sent");
    assert.deepEqual(nothing.batches, []);

    // A sale at another till changes one product's stock: only that product (and its batches) comes back.
    const sold = full.products.find((product) => full.batches.some((batch) => batch.productId === product.id && !batch.blocked && batch.availableQuantity > 2) && product.lifecycle === "ACTIVE" && !product.rxOnly);
    const level = sold.packaging.find((row) => row.isBase);
    const sale = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: null, lines: [{ productId: sold.id, quantity: 1, packagingId: level.id }], payments: [{ method: "Cash", amount: 1_000_000 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.data));
    const delta = await pull(cashier, device, { known: { ...known, "prod-gone-123": "x" } });
    assert.deepEqual(delta.products.map((product) => product.id), [sold.id]);
    assert.equal(delta.products[0].stock, sold.stock - 1);
    assert.ok(delta.batches.length > 0 && delta.batches.every((batch) => batch.productId === sold.id));
    assert.deepEqual(delta.removedProducts, ["prod-gone-123"], "products no longer at the outlet are reported");

    // A price change is a change too.
    const priced = await admin.patch(`/api/products/${full.products[0].id}`, { pricing: { sellingPrice: full.products[0].sellingPrice + 1 } });
    assert.equal(priced.status, 200);
    const again = await pull(cashier, device, { known: Object.fromEntries([...full.products, ...delta.products].map((product) => [product.id, product.fp])) });
    assert.ok(again.products.some((product) => product.id === full.products[0].id));
  });
});

describe("Reports for offline viewing", () => {
  test("a dated sales snapshot goes to people allowed to see sales figures only", async () => {
    const manager = await signedIn(server.baseUrl, "admin@web365.ng");
    const device = await register(manager);
    const pack = await pull(manager, device);
    assert.equal(pack.reports.generatedAt, pack.issuedAt);
    assert.equal(pack.reports.sales.days.length, 7);
    assert.ok(pack.reports.sales.days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && typeof day.total === "number"));
    const cashierPack = await pull(cashier, await register(cashier));
    assert.equal(cashierPack.reports.sales, null, "cashiers do not get outlet sales figures");
  });
});
