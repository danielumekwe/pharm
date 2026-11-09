// Native app authentication: POST /api/mobile/login issues a bearer token; API routes accept it.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
const login = (identifier, outletId = "HQ", password = "Admin@123") => call("POST", "/api/mobile/login", { body: { identifier, password, outletId } });

describe("Mobile login", () => {
  test("issues a token with the user's profile and permissions", async () => {
    const { status, data } = await login("cashier@web365.ng", "outlet-1");
    assert.equal(status, 200, JSON.stringify(data));
    assert.ok(data.token.length > 40);
    assert.equal(data.user.role, "CASHIER");
    assert.equal(data.user.outletId, "outlet-1");
    assert.ok(data.user.permissions.includes("sales.create"));
  });

  test("without an outlet, signs in at the account's own location and lists where it may work", async () => {
    const cashier = await call("POST", "/api/mobile/login", { body: { identifier: "cashier@web365.ng", password: "Admin@123" } });
    assert.equal(cashier.status, 200, JSON.stringify(cashier.data));
    assert.equal(cashier.data.user.outletId, "outlet-1");
    assert.ok(cashier.data.pharmacy.locations.some((location) => location.id === "outlet-1"));
    const admin = await call("POST", "/api/mobile/login", { body: { identifier: "admin@web365.ng", password: "Admin@123" } });
    assert.equal(admin.status, 200);
    assert.ok(admin.data.pharmacy.locations.length > 1, "a central role may choose Head Office or an outlet");
  });

  test("the daily report is available to the app for managers, not cashiers", async () => {
    const admin = await call("POST", "/api/mobile/login", { body: { identifier: "admin@web365.ng", password: "Admin@123" } });
    const report = await call("GET", "/api/reports/daily", { token: admin.data.token });
    assert.equal(report.status, 200, JSON.stringify(report.data));
    assert.equal(typeof report.data.totalSales, "number");
    assert.equal(report.data.financial, true);
    assert.match(report.data.day, /^\d{4}-\d{2}-\d{2}$/);
    const cashier = await call("POST", "/api/mobile/login", { body: { identifier: "cashier@web365.ng", password: "Admin@123" } });
    assert.equal((await call("GET", "/api/reports/daily", { token: cashier.data.token })).status, 403);
  });

  test("rejects a wrong password and a disallowed outlet", async () => {
    assert.equal((await login("cashier@web365.ng", "outlet-1", "wrong-password")).status, 401);
    const hq = await login("cashier@web365.ng", "HQ");
    assert.equal(hq.status, 403);
    assert.match(hq.data.error, /Select/);
  });
});

describe("Bearer access to the API", () => {
  test("the token authenticates API calls with the same role limits as the web", async () => {
    const { data } = await login("cashier@web365.ng", "outlet-1");
    const dashboard = await call("GET", "/api/dashboard", { token: data.token });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.kind, "cashier");
    assert.equal((await call("GET", "/api/pos/catalog?outletId=outlet-1", { token: data.token })).status, 200);
    assert.equal((await call("GET", "/api/pos/catalog?outletId=outlet-2", { token: data.token })).status, 403, "other outlets stay closed");
    assert.equal((await call("GET", "/api/products", { token: data.token })).status, 403, "cashiers cannot list inventory");
  });

  test("invalid tokens are refused, not treated as anonymous cookies", async () => {
    assert.equal((await call("GET", "/api/dashboard", { token: "not-a-token" })).status, 401);
    assert.equal((await call("GET", "/api/dashboard")).status, 401);
  });

  test("a deactivated user's token stops working immediately", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const { data } = await login("relief@web365.ng", "outlet-1");
    assert.equal((await call("GET", "/api/dashboard", { token: data.token })).status, 200);
    const [relief] = await server.query("SELECT id FROM users WHERE email = 'relief@web365.ng'");
    const patched = await admin.patch(`/api/users/${relief.id}`, { action: "status", status: "SUSPENDED", reason: "Left the company" });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal((await call("GET", "/api/dashboard", { token: data.token })).status, 401);
  });
});
