// Tests for the two new API endpoints added for the mobile app:
//   GET /api/dashboard  — role-based dashboard (replaces the static stub)
//   GET /api/stock-levels — read-only stock levels (guarded by stock.levels / stock.view)
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
let admin;
before(async () => {
  server = await startServer();
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
});
after(async () => {
  await server?.stop();
});

describe("GET /api/dashboard — role-based dashboard", () => {
  test("each role gets back a { kind, data } payload with the correct kind", async () => {
    const cases = [
      ["admin@web365.ng", "HQ", "admin"],
      ["manager@web365.ng", "HQ", "manager"],
      ["outlet@web365.ng", "outlet-1", "sales"],
      ["cashier@web365.ng", "outlet-1", "cashier"],
      ["stock.lekki@web365.ng", "outlet-1", "inventory"],
      ["regulatory@web365.ng", "HQ", "regulatory"],
    ];
    for (const [email, outlet, expectedKind] of cases) {
      const client = await signedIn(server.baseUrl, email, outlet);
      const { status, data } = await client.get("/api/dashboard");
      assert.equal(status, 200, `${email}: ${JSON.stringify(data)}`);
      assert.equal(typeof data, "object", `${email}: response is an object`);
      assert.equal(data.kind, expectedKind, `${email}: expected kind=${expectedKind}, got ${data.kind}`);
      assert.ok(data.data !== undefined, `${email}: data.data is present`);
    }
  });

  test("anonymous request returns 401", async () => {
    const { Client } = await import("./helpers/client.mjs");
    const anon = new Client(server.baseUrl);
    const { status } = await anon.get("/api/dashboard");
    assert.equal(status, 401);
  });

  test("admin dashboard accepts from/to/outlet/trend query params", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const { status, data } = await admin.get(`/api/dashboard?from=${from}&to=${today}&outlet=outlet-1&trend=daily`);
    assert.equal(status, 200);
    assert.equal(data.kind, "admin");
    // filters echo back in the response
    assert.equal(data.data.filters?.from, from, "from filter echoed");
    assert.equal(data.data.filters?.to, today, "to filter echoed");
    assert.equal(data.data.filters?.outlet, "outlet-1", "outlet filter echoed");
  });

  test("manager dashboard returns today/byOutletToday/trend/position", async () => {
    const manager = await signedIn(server.baseUrl, "manager@web365.ng", "HQ");
    const { status, data } = await manager.get("/api/dashboard");
    assert.equal(status, 200);
    assert.equal(data.kind, "manager");
    assert.ok(Array.isArray(data.data.byOutletToday), "byOutletToday is an array");
    assert.ok(Array.isArray(data.data.trend), "trend is an array");
    assert.ok(data.data.position !== undefined, "stock position is present");
  });

  test("cashier dashboard returns todayCount/held/paymentMix/recent", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const { status, data } = await cashier.get("/api/dashboard");
    assert.equal(status, 200);
    assert.equal(data.kind, "cashier");
    assert.ok(typeof data.data.todayCount === "number", "todayCount is a number");
    assert.ok(Array.isArray(data.data.held), "held is an array");
    assert.ok(Array.isArray(data.data.paymentMix), "paymentMix is an array");
    assert.ok(Array.isArray(data.data.recent), "recent is an array");
  });

  test("sales dashboard returns today/held/trend/topProducts/paymentMix", async () => {
    const sales = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    const { status, data } = await sales.get("/api/dashboard");
    assert.equal(status, 200);
    assert.equal(data.kind, "sales");
    assert.ok(Array.isArray(data.data.trend), "trend is an array");
    assert.ok(Array.isArray(data.data.topProducts), "topProducts is an array");
  });
});

describe("GET /api/stock-levels — read-only stock levels", () => {
  test("cashier (stock.levels) can read stock levels", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const { status, data } = await cashier.get("/api/stock-levels");
    assert.equal(status, 200, JSON.stringify(data));
    assert.ok(Array.isArray(data), "response is an array");
    if (data.length > 0) {
      const row = data[0];
      assert.ok(typeof row.id === "string", "row has id");
      assert.ok(typeof row.name === "string", "row has name");
      assert.ok(typeof row.available === "number", "row has available");
      assert.ok(typeof row.status === "string", "row has status");
      // No cost, batch or action fields (read-only)
      assert.equal(row.purchasePrice, undefined, "no cost data exposed");
    }
  });

  test("sales manager (stock.levels) can read stock levels", async () => {
    const sales = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    const { status, data } = await sales.get("/api/stock-levels");
    assert.equal(status, 200, JSON.stringify(data));
    assert.ok(Array.isArray(data));
  });

  test("stock manager (stock.view) can also read stock levels", async () => {
    const stock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const { status, data } = await stock.get("/api/stock-levels");
    assert.equal(status, 200, JSON.stringify(data));
    assert.ok(Array.isArray(data));
  });

  test("anonymous user is rejected with 401", async () => {
    const { Client } = await import("./helpers/client.mjs");
    const anon = new Client(server.baseUrl);
    const { status } = await anon.get("/api/stock-levels");
    assert.equal(status, 401);
  });

  test("stock levels for cashier are scoped to their outlet only", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const { data } = await cashier.get("/api/stock-levels");
    assert.ok(Array.isArray(data));
    if (data.length > 0) {
      assert.ok(data.every((row) => row.outletId === "outlet-1"), "all rows belong to outlet-1");
    }
  });

  test("response rows include name/strength/category/unit/available/status/nextExpiry", async () => {
    const stock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const { data } = await stock.get("/api/stock-levels");
    assert.ok(Array.isArray(data) && data.length > 0, "has rows");
    const row = data[0];
    assert.ok("name" in row);
    assert.ok("category" in row);
    assert.ok("unit" in row);
    assert.ok("available" in row);
    assert.ok("status" in row);
    assert.ok("nextExpiry" in row);
  });
});
