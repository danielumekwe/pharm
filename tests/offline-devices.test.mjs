// Offline devices (stage 2): registration with a device key, signed requests, the offline data package
// (scoped to user and outlet), check-ins, revocation, offline policy and tenant isolation.
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

/** A device as the browser creates it: non-extractable ECDSA P-256 key. */
async function newDevice() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKey = Buffer.from(await subtle.exportKey("spki", pair.publicKey)).toString("base64");
  return { pair, publicKey };
}

async function signed(client, device, path, body = {}, { time = new Date().toISOString(), id = device.id, key = device.pair.privateKey } = {}) {
  const signature = Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${id}.${time}.POST.${path}`))).toString("base64");
  const response = await fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { cookie: client.cookieHeader(), "Content-Type": "application/json", "X-Device-Id": id, "X-Device-Time": time, "X-Device-Signature": signature },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, data: await response.json() };
}

async function register(client, outletId, name = "Front counter") {
  const device = await newDevice();
  const response = await client.post("/api/offline/devices", { name, outletId, publicKey: device.publicKey, platform: "Test" });
  return { response, device: { ...device, id: response.data?.id } };
}

describe("Registration", () => {
  test("a signed-in user registers a device for one of their outlets", async () => {
    const { response } = await register(cashier, "outlet-1");
    assert.equal(response.status, 201, JSON.stringify(response.data));
    assert.equal(response.data.status, "ACTIVE");
    assert.equal(response.data.ready, false, "not ready until the data is downloaded");
    assert.equal(response.data.outletId, "outlet-1");
    const [row] = await server.query("SELECT public_key, tenant_id FROM offline_devices WHERE id = ?", response.data.id);
    assert.equal(row.tenant_id, "tenant-demo");
    assert.ok(row.public_key.length > 80, "only the public key is stored");
  });

  test("outlet staff cannot register for another outlet; bad keys and support-free rules apply", async () => {
    assert.equal((await register(cashier, "outlet-2")).response.status, 403);
    const bad = await cashier.post("/api/offline/devices", { name: "X device", outletId: "outlet-1", publicKey: Buffer.from("not a key at all, just text padding....").toString("base64") });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /device key is not valid/);
    assert.equal((await register(cashier, "outlet-1", "x")).response.status, 400, "a name is required");
  });
});

describe("Offline data package", () => {
  let device;
  before(async () => {
    ({ device } = await register(cashier, "outlet-1", "Lekki till 1"));
  });

  test("requires the device signature as well as the session", async () => {
    const path = "/api/offline/package";
    const plain = await cashier.post(path, {});
    assert.equal(plain.status, 401, "session alone is not enough");
    const other = await newDevice();
    assert.equal((await signed(cashier, device, path, {}, { key: other.pair.privateKey })).status, 401, "wrong key");
    assert.equal((await signed(cashier, device, path, {}, { time: new Date(Date.now() - 10 * 60_000).toISOString() })).status, 401, "old signature");
    const anonymous = await fetch(`${server.baseUrl}${path}`, { method: "POST" });
    assert.equal(anonymous.status, 401);
    assert.equal((await signed(admin, device, path)).status, 403, "the device belongs to the cashier, not to the admin");
  });

  test("holds only the user's outlet, without cost prices or customer contact details for a cashier", async () => {
    const { status, headers, data } = await signed(cashier, device, "/api/offline/package");
    assert.equal(status, 200, JSON.stringify(data));
    assert.match(headers.get("cache-control"), /no-store/);
    assert.equal(data.outlet.id, "outlet-1");
    assert.equal(data.user.role, "CASHIER");
    assert.ok(data.products.length > 0);
    assert.ok(data.products.every((product) => product.outletId === "outlet-1"), "products of this outlet only");
    assert.ok(data.batches.every((batch) => batch.outletId === "outlet-1"), "batches of this outlet only");
    assert.ok(data.products.every((product) => product.purchasePrice === null), "no cost prices for a cashier");
    assert.ok(data.products.some((product) => product.packaging.length >= 1 && Array.isArray(product.barcodes)));
    for (const customer of data.customers) assert.deepEqual(Object.keys(customer).sort(), ["code", "id", "name", "type"]);
    const hours = (Date.parse(data.validUntil) - Date.parse(data.issuedAt)) / 3_600_000;
    assert.equal(Math.round(hours), 72, "default offline access: 72 hours");
    const list = (await admin.get("/api/offline/devices")).data.find((row) => row.id === device.id);
    assert.equal(list.ready, true);
    assert.ok(list.lastPackageAt);
  });

  test("check-ins report unsent work to the administrators", async () => {
    const beat = await signed(cashier, device, "/api/offline/heartbeat", { pending: 3, failed: 1, counts: { products: 12, batches: 30 } });
    assert.equal(beat.status, 200, JSON.stringify(beat.data));
    const row = (await admin.get("/api/offline/devices")).data.find((entry) => entry.id === device.id);
    assert.equal(row.pendingCount, 3);
    assert.equal(row.failedCount, 1);
    assert.deepEqual(row.localCounts, { products: 12, batches: 30 });
    const own = (await cashier.get("/api/offline/devices")).data;
    assert.ok(own.every((entry) => entry.userName === own[0].userName), "a cashier sees only their own devices");
  });

  test("a revoked device is told so (410) and can no longer download", async () => {
    const revoked = await admin.patch(`/api/offline/devices/${device.id}`, { revoke: true, reason: "Tablet stolen" });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.data));
    assert.equal(revoked.data.status, "REVOKED");
    const beat = await signed(cashier, device, "/api/offline/heartbeat", {});
    assert.equal(beat.status, 410);
    assert.match(beat.data.error, /Tablet stolen/);
    assert.equal((await signed(cashier, device, "/api/offline/package")).status, 410);
    const [audit] = await server.query("SELECT summary FROM audit_events WHERE action = 'devices.revoke' AND entity_id = ?", device.id);
    assert.match(audit.summary, /expires/);
  });
});

describe("Policy and management", () => {
  test("only Super Admins change the policy; expiry and switch-off apply", async () => {
    assert.equal((await cashier.patch("/api/offline/policy", { sessionHours: 5 })).status, 403);
    assert.equal((await admin.patch("/api/offline/policy", { sessionHours: 0 })).status, 400);
    assert.equal((await admin.patch("/api/offline/policy", { sessionHours: 2 })).status, 200);
    const { device } = await register(cashier, "outlet-1", "Short-lived");
    const pack = (await signed(cashier, device, "/api/offline/package")).data;
    assert.equal(Math.round((Date.parse(pack.validUntil) - Date.parse(pack.issuedAt)) / 3_600_000), 2);
    assert.equal((await admin.patch("/api/offline/policy", { enabled: false })).status, 200);
    const off = await register(cashier, "outlet-1", "Blocked");
    assert.equal(off.response.status, 403);
    assert.match(off.response.data.error, /switched off/);
    await admin.patch("/api/offline/policy", { enabled: true, sessionHours: 72 });
  });

  test("users may rename and remove their own devices, not other people's", async () => {
    const { device } = await register(admin, "outlet-1", "Admin laptop");
    assert.equal((await cashier.patch(`/api/offline/devices/${device.id}`, { name: "Mine now" })).status, 404);
    assert.equal((await admin.patch(`/api/offline/devices/${device.id}`, { name: "Admin laptop 2" })).data.name, "Admin laptop 2");
    const { device: own } = await register(cashier, "outlet-1", "Cashier phone");
    const removed = await cashier.patch(`/api/offline/devices/${own.id}`, { revoke: true });
    assert.equal(removed.data.status, "REVOKED");
  });

  test("the management page is for Super Admins; the install page shows the set-up form", async () => {
    assert.equal((await admin.request("GET", "/settings/devices", undefined, { raw: true })).status, 200);
    assert.equal((await cashier.request("GET", "/settings/devices", undefined, { raw: true })).status, 307);
    const html = await (await cashier.request("GET", "/install", undefined, { raw: true })).text();
    assert.match(html, /Offline use on this device/);
  });
});

describe("Tenant isolation", () => {
  test("another pharmacy cannot use or see a device", async () => {
    const [account] = await server.query("SELECT password, password_hash FROM users WHERE email = 'admin@web365.ng'");
    await server.query("INSERT INTO tenants (id, slug, name) VALUES ('tenant-off', 'offline-b', 'Offline B')");
    await server.query("INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle) VALUES ('sub-tenant-off', 'tenant-off', 'starter', 'ACTIVE', 'MONTHLY')");
    await server.query("INSERT INTO outlets (id, tenant_id, name, code, status, seq) VALUES ('outlet-off1', 'tenant-off', 'Offline B Main', 'OFFB', 'OPEN', 1)");
    await server.query("INSERT INTO users (id, name, email, role, status, password, password_hash, seq) VALUES ('user-off1', 'Offline B Owner', 'owner@offline-b.ng', 'SUPER_ADMIN', 'ACTIVE', ?, ?, 997)", account.password, account.password_hash);
    await server.query("INSERT INTO tenant_memberships (id, tenant_id, user_id, role, staff_id) VALUES ('mem-tenant-off-user-off1', 'tenant-off', 'user-off1', 'SUPER_ADMIN', 'OFF-0001')");
    await server.query("INSERT INTO app_state (tenant_id, key, value) VALUES ('tenant-off', 'settings', ?)", JSON.stringify({ businessName: "Offline B" }));
    const owner = await signedIn(server.baseUrl, "owner@offline-b.ng");
    const { device } = await register(cashier, "outlet-1", "Demo device");
    assert.deepEqual((await owner.get("/api/offline/devices")).data, []);
    assert.equal((await signed(owner, device, "/api/offline/package")).status, 403);
    assert.equal((await owner.patch(`/api/offline/devices/${device.id}`, { revoke: true, reason: "not mine" })).status, 404);
    assert.equal((await register(owner, "outlet-1")).response.status, 404, "cannot register for another pharmacy's outlet");
  });
});
