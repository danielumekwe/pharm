// Requirements D1–D4: Super Admin impersonation.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

const SALES_MANAGER_LEKKI = "user-6"; // Aisha Bello, Sales Manager, Outlet 1 - Lekki

async function setImpersonation(client, enabled, onDisable = "terminate") {
  const response = await client.post("/api/settings", { action: "impersonation", enabled, onDisable, maxMinutes: 30 });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}

async function startAs(client, targetUserId, password = "Admin@123") {
  const started = await client.post("/api/impersonation", { targetUserId, password, reason: "Automated test session" });
  if (started.status !== 201) return { started };
  const session = await client.updateSession({ impersonate: started.data.sessionId });
  return { started, session };
}

describe("Super Admin user impersonation", () => {
  test("D2: impersonation is blocked when the setting is disabled (default)", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const attempt = await admin.post("/api/impersonation", { targetUserId: SALES_MANAGER_LEKKI, password: "Admin@123", reason: "Should be refused" });
    assert.equal(attempt.status, 403);
    assert.match(attempt.data.error, /disabled/i);
    // A forged session update cannot start one either.
    const session = await admin.updateSession({ impersonate: "imp-forged-123" });
    assert.equal(session.user.id, "user-1");
    assert.equal(session.user.impersonation, null);
    assert.equal((await server.query("SELECT COUNT(*) AS n FROM impersonation_sessions"))[0].n, 0);
  });

  test("D1: Super Admin can impersonate when enabled, with fresh password confirmation", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    await setImpersonation(admin, true);

    const wrong = await admin.post("/api/impersonation", { targetUserId: SALES_MANAGER_LEKKI, password: "not-my-password", reason: "Wrong password" });
    assert.equal(wrong.status, 401);

    const { started, session } = await startAs(admin, SALES_MANAGER_LEKKI);
    assert.equal(started.status, 201);
    assert.equal(session.user.id, SALES_MANAGER_LEKKI);
    assert.equal(session.user.role, "SALES_MANAGER");
    assert.equal(session.user.impersonation.adminId, "user-1");
    assert.deepEqual(session.user.outletIds, ["outlet-1"]);
    assert.ok(!session.user.permissions.includes("settings.manage"), "target permissions only");
    assert.ok(!session.user.permissions.includes("permissions.manage"));

    // No privilege escalation while impersonating.
    assert.equal((await admin.post("/api/settings", { action: "update", vatRate: 5 })).status, 403);
    assert.equal((await admin.post("/api/impersonation", { targetUserId: "user-4", password: "Admin@123", reason: "Nested attempt" })).status, 403);

    // Cannot impersonate another Super Admin or oneself (checked with a fresh admin session).
    const other = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await other.post("/api/impersonation", { targetUserId: "user-1", password: "Admin@123", reason: "Self attempt" })).status, 400);

    // Return to Super Admin.
    assert.equal((await admin.delete("/api/impersonation")).status, 200);
    const back = await admin.updateSession({ impersonate: null });
    assert.equal(back.user.id, "user-1");
    assert.equal(back.user.impersonation, null);
  });

  test("D3: an impersonated user cannot access another outlet's data", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    await setImpersonation(admin, true);
    await startAs(admin, SALES_MANAGER_LEKKI);

    assert.equal((await admin.get("/api/sales-overview?outlet=outlet-2")).status, 403);
    const foreignSale = await admin.post("/api/sales", { outletId: "outlet-2", customerId: "cus-1", paymentMethod: "Cash", lines: [{ productId: "prod-9", quantity: 1 }] });
    assert.equal(foreignSale.status, 403);
    const sales = await admin.get("/api/sales");
    assert.equal(sales.status, 200);
    assert.ok(sales.data.sales.length > 0);
    assert.ok(sales.data.sales.every((sale) => sale.outletId === "outlet-1"), "only Lekki sales are visible");
    // Switching outlet to one the target is not assigned to is ignored server-side.
    const switched = await admin.updateSession({ outletId: "outlet-3" });
    assert.equal(switched.user.outletId, "outlet-1");

    await admin.delete("/api/impersonation");
    await admin.updateSession({ impersonate: null });
  });

  test("D4: impersonation sessions and the actions taken are audited", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    await setImpersonation(admin, true);
    const { started } = await startAs(admin, SALES_MANAGER_LEKKI);
    const sessionId = started.data.sessionId;

    const sale = await admin.post("/api/sales", { outletId: "outlet-1", customerId: "cus-1", paymentMethod: "Cash", lines: [{ productId: "prod-8", quantity: 1 }] });
    assert.equal(sale.status, 201);
    assert.equal(sale.data.cashierId, SALES_MANAGER_LEKKI, "the sale is attributed to the impersonated user");

    await admin.delete("/api/impersonation");
    await admin.updateSession({ impersonate: null });

    const [row] = await server.query("SELECT * FROM impersonation_sessions WHERE id = ?", sessionId);
    assert.equal(row.admin_id, "user-1");
    assert.equal(row.target_id, SALES_MANAGER_LEKKI);
    assert.ok(row.started_at);
    assert.ok(row.ended_at, "end time recorded");
    assert.match(row.end_reason, /returned/);
    assert.ok(row.actions >= 1);

    const actions = await server.query("SELECT action, actor_id, impersonator_id FROM audit_events WHERE impersonation_id = ?", sessionId);
    assert.ok(actions.some((event) => event.action === "sale.create" && event.actor_id === SALES_MANAGER_LEKKI && event.impersonator_id === "user-1"));
    const lifecycle = (await server.query("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY at", sessionId)).map((event) => event.action);
    assert.ok(lifecycle.includes("impersonation.start") && lifecycle.includes("impersonation.end"));
    assert.ok((await server.query("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'impersonation.denied'"))[0].n >= 1, "failed confirmations are audited");
  });

  test("D2: disabling the feature terminates a running session (terminate policy)", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    await setImpersonation(admin, true, "terminate");
    const { started, session } = await startAs(admin, "user-4");
    assert.equal(session.user.id, "user-4");

    const controller = await signedIn(server.baseUrl, "admin@web365.ng");
    const result = await setImpersonation(controller, false, "terminate");
    assert.ok(result.terminated >= 1);

    const after = await admin.session();
    assert.equal(after.user.id, "user-1", "falls back to the administrator");
    assert.equal(after.user.impersonation, null);
    const [row] = await server.query("SELECT ended_at, end_reason FROM impersonation_sessions WHERE id = ?", started.data.sessionId);
    assert.ok(row.ended_at);
    assert.match(row.end_reason, /disabled/);
    assert.equal((await admin.post("/api/impersonation", { targetUserId: "user-4", password: "Admin@123", reason: "After disable" })).status, 403);
  });

  test("anonymous and non-admin callers cannot start impersonation", async () => {
    const anonymous = new Client(server.baseUrl);
    assert.equal((await anonymous.post("/api/impersonation", { targetUserId: "user-4", password: "x", reason: "anon" })).status, 401);
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    await setImpersonation(admin, true);
    const attempt = await manager.post("/api/impersonation", { targetUserId: "user-4", password: "Admin@123", reason: "PM attempt" });
    assert.equal(attempt.status, 403);
  });
});
