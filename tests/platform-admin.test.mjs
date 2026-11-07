// SaaS phase 4: platform administration (Web365) kept apart from pharmacy administration.
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
let sunrise; // a self-registered pharmacy
const PLATFORM_ADMIN = { email: "ops@web365.ng", password: "Platform-Admin-2026", name: "Ada Obi" };
const PLATFORM_SUPPORT = { email: "support@web365.ng", password: "Platform-Support-2026", name: "Bayo Support" };

const hash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex")}`;
};

before(async () => {
  server = await startServer();
  await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES ('puser-admin', ?, ?, 'PLATFORM_SUPER_ADMIN', ?)", PLATFORM_ADMIN.email, PLATFORM_ADMIN.name, hash(PLATFORM_ADMIN.password));
  await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES ('puser-support', ?, ?, 'PLATFORM_SUPPORT', ?)", PLATFORM_SUPPORT.email, PLATFORM_SUPPORT.name, hash(PLATFORM_SUPPORT.password));
  const response = await fetch(`${server.baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(), businessName: "Sunrise Pharmacy", businessEmail: "hello@sunrise.ng", businessPhone: "0803 123 4567", ownerName: "Ngozi Okafor",
      ownerEmail: "ngozi@sunrise.ng", ownerPhone: "0809 765 4321", address: "12 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN",
      timeZone: "Africa/Lagos", password: "Sunrise2026", planId: "starter", billingCycle: "MONTHLY",
    }),
  });
  sunrise = await response.json();
  assert.equal(response.status, 201, JSON.stringify(sunrise));
});
after(async () => {
  await server?.stop();
});

async function platformSession({ email, password }) {
  const client = new Client(server.baseUrl);
  const response = await client.post("/api/platform/login", { email, password });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return client;
}
const raw = (client, method, path, body) => client.request(method, path, body, { raw: true });
async function sunriseOwner() {
  const client = new Client(server.baseUrl);
  assert.equal(await client.login("ngozi@sunrise.ng", "HQ", "Sunrise2026"), null);
  return client;
}

describe("Two separate administration systems", () => {
  test("a pharmacy Super Admin has no platform access, and the pharmacy session cannot be used as a platform session", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await admin.get("/api/platform/tenants")).status, 401);
    assert.equal((await admin.post("/api/platform/tenants/tenant-demo/support", { reason: "trying to get in", minutes: 60 })).status, 401);
    const page = await raw(admin, "GET", "/platform");
    assert.equal(page.status, 307);
    assert.match(page.headers.get("location"), /\/platform\/login/);
    // The pharmacy session token placed in the platform cookie is rejected (different key).
    const forged = new Client(server.baseUrl);
    forged.cookies.set("pharm_platform", admin.cookies.get("next-auth.session-token"));
    assert.equal((await forged.get("/api/platform/tenants")).status, 401);
  });

  test("a platform session gives no access to pharmacy records", async () => {
    const ops = await platformSession(PLATFORM_ADMIN);
    assert.equal((await ops.get("/api/products")).status, 401);
    assert.equal((await ops.get("/api/sales")).status, 401);
    const dashboard = await raw(ops, "GET", "/dashboard");
    assert.ok([302, 307].includes(dashboard.status), "the pharmacy app sends platform staff to sign in");
    const list = await ops.get("/api/platform/tenants");
    assert.equal(list.status, 200);
    const names = (await server.query("SELECT name FROM tenants ORDER BY name")).map((row) => row.name);
    assert.deepEqual(list.data.tenants.map((tenant) => tenant.name).sort(), names);
    const demo = list.data.tenants.find((tenant) => tenant.id === "tenant-demo");
    assert.ok(demo.outlets > 0 && demo.members > 0, "usage counts");
    const [product] = await server.query("SELECT name FROM products WHERE tenant_id = 'tenant-demo' LIMIT 1");
    const [customer] = await server.query("SELECT name FROM customers WHERE tenant_id = 'tenant-demo' LIMIT 1");
    const detail = JSON.stringify((await ops.get("/api/platform/tenants/tenant-demo")).data);
    for (const record of [product.name, customer.name, "INV-0"]) assert.ok(!JSON.stringify(list.data).includes(record) && !detail.includes(record), `platform view shows ${record}`);
  });

  test("platform sign-in is checked and recorded", async () => {
    const wrong = await new Client(server.baseUrl).post("/api/platform/login", { email: PLATFORM_ADMIN.email, password: "not-the-password" });
    assert.equal(wrong.status, 401);
    const pharmacyAdmin = await new Client(server.baseUrl).post("/api/platform/login", { email: "admin@web365.ng", password: "Admin@123" });
    assert.equal(pharmacyAdmin.status, 401, "pharmacy accounts cannot sign in to the platform");
    const actions = (await server.query("SELECT action FROM platform_audit_events")).map((row) => row.action);
    assert.ok(actions.includes("platform.login") && actions.includes("platform.login-failed"));
  });

  test("the pharmacy role is called Pharmacy Super Admin", async () => {
    const owner = await sunriseOwner();
    const html = await (await raw(owner, "GET", "/users")).text();
    assert.match(html, /Pharmacy Super Admin/);
  });
});

describe("Managing pharmacies", () => {
  test("suspending needs a reason, cuts off the pharmacy's users with that reason, and is reversible", async () => {
    const ops = await platformSession(PLATFORM_ADMIN);
    const owner = await sunriseOwner();
    assert.equal((await ops.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "suspend", reason: "x" })).status, 400);
    assert.equal((await ops.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "suspend", reason: "Unpaid invoice INV-2026-11" })).status, 200);
    assert.equal((await owner.get("/api/products")).status, 401);
    assert.match(await new Client(server.baseUrl).login("ngozi@sunrise.ng", "HQ", "Sunrise2026"), /Sunrise Pharmacy is suspended: Unpaid invoice INV-2026-11/);
    assert.equal((await ops.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "reactivate" })).status, 200);
    assert.equal((await owner.get("/api/products")).status, 200);
    const audit = await server.query("SELECT action, tenant_id, actor_name FROM platform_audit_events WHERE action IN ('tenant.suspend', 'tenant.reactivate') ORDER BY at");
    assert.deepEqual(audit.map((row) => [row.action, row.tenant_id]), [["tenant.suspend", sunrise.tenantId], ["tenant.reactivate", sunrise.tenantId]]);
  });

  test("a trial can be extended; an active subscription cannot", async () => {
    const ops = await platformSession(PLATFORM_ADMIN);
    const [before] = await server.query("SELECT trial_ends_at FROM subscriptions WHERE tenant_id = ?", sunrise.tenantId);
    const extended = await ops.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "extend-trial", days: 10, reason: "Onboarding took longer" });
    assert.equal(extended.status, 200, JSON.stringify(extended.data));
    const [after] = await server.query("SELECT trial_ends_at FROM subscriptions WHERE tenant_id = ?", sunrise.tenantId);
    assert.equal(Math.round((new Date(after.trial_ends_at) - new Date(before.trial_ends_at)) / 86_400_000), 10);
    assert.equal((await ops.patch("/api/platform/tenants/tenant-demo", { action: "extend-trial", days: 10, reason: "Not a trial" })).status, 400);
  });

  test("platform admins can configure plans and assign one to a pharmacy", async () => {
    const ops = await platformSession(PLATFORM_ADMIN);
    const support = await platformSession(PLATFORM_SUPPORT);
    const config = {
      name: "Starter",
      description: "One outlet and three staff accounts.",
      monthlyPrice: null,
      annualPrice: null,
      currency: "NGN",
      trialDays: 14,
      maxOutlets: 1,
      maxStaffAccounts: 3,
      features: null,
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    };
    assert.equal((await support.patch("/api/platform/plans/starter", config)).status, 403);
    assert.equal((await ops.patch("/api/platform/plans/starter", { ...config, monthlyPrice: 1.23456 })).status, 422);
    assert.equal((await ops.patch("/api/platform/plans/starter", config)).status, 200);
    assert.deepEqual(
      await server.query("SELECT max_outlets, max_staff_accounts, monthly_price, annual_price FROM plans WHERE id = 'starter'"),
      [{ max_outlets: 1, max_staff_accounts: 3, monthly_price: null, annual_price: null }],
    );

    const changed = await ops.patch(`/api/platform/tenants/${sunrise.tenantId}`, {
      action: "change-plan",
      planId: "professional",
      billingCycle: "ANNUAL",
      reason: "Customer upgraded by phone",
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.deepEqual(
      await server.query("SELECT plan_id, billing_cycle FROM subscriptions WHERE tenant_id = ?", sunrise.tenantId),
      [{ plan_id: "professional", billing_cycle: "ANNUAL" }],
    );
    await ops.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "change-plan", planId: "starter", billingCycle: "MONTHLY", reason: "Back to the starter plan" });
  });

  test("documented Starter outlet and staff limits are enforced when adding accounts", async () => {
    const owner = await sunriseOwner();
    const outlet = await owner.post("/api/outlets", {
      name: "Second Outlet",
      code: "OUT-99",
      type: "RETAIL",
      address: "99 Test Avenue, Ikeja",
      manager: "Ngozi Okafor",
      phone: "08031234567",
      pcnLicense: "Pending",
      licenceExpiry: "",
    });
    assert.equal(outlet.status, 403);
    assert.match(outlet.data.error, /Starter plan allows up to 1 outlet/);

    const [mainOutlet] = await server.query("SELECT id FROM outlets WHERE tenant_id = ?", sunrise.tenantId);
    const staff = (n) => ({
      name: `Test Staff ${n}`,
      email: `test-staff-${n}@sunrise.ng`,
      phone: "08031234567",
      role: "CASHIER",
      outletIds: [mainOutlet.id],
      primaryOutletId: mainOutlet.id,
      status: "ACTIVE",
      credential: { mode: "invite" },
    });
    const first = await owner.post("/api/users", staff(1));
    const second = await owner.post("/api/users", staff(2));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const capped = await owner.post("/api/users", staff(3));
    assert.equal(capped.status, 403);
    assert.match(capped.data.error, /Starter plan allows up to 3 staff accounts/);
    for (const created of [first, second]) {
      await owner.patch(`/api/users/${created.data.user.id}`, { action: "status", status: "DEACTIVATED", reason: "Test cleanup" });
    }
  });

  test("an enabled feature allowlist blocks features not granted to the plan", async () => {
    const owner = await sunriseOwner();
    await server.query("UPDATE plans SET features = '[]'::jsonb WHERE id = 'starter'");
    try {
      const transfer = await owner.post("/api/transfers", {
        fromOutletId: "outlet-1",
        toOutletId: "outlet-2",
        lines: [{ productId: "prod-not-used", quantity: 1 }],
      });
      assert.equal(transfer.status, 403);
      assert.match(transfer.data.error, /does not include stock transfers/);
      const regulatory = await owner.patch("/api/regulatory/registrations/not-used", {
        nafdacNumber: "A4-12345",
        issuedDate: "2026-01-01",
        expiryDate: "2027-01-01",
      });
      assert.equal(regulatory.status, 403);
      assert.match(regulatory.data.error, /does not include regulatory management/);
    } finally {
      await server.query("UPDATE plans SET features = NULL WHERE id = 'starter'");
    }
  });

  test("past-due subscriptions route pages to the subscription screen and block API use", async () => {
    const owner = await sunriseOwner();
    await server.query("UPDATE subscriptions SET status = 'PAST_DUE' WHERE tenant_id = ?", sunrise.tenantId);
    try {
      assert.equal((await owner.get("/api/products")).status, 402);
      assert.equal((await owner.get("/api/inventory-reports")).status, 402);
      assert.equal((await owner.get("/api/sales-overview")).status, 402);
      assert.equal((await owner.get("/api/reports/export")).status, 402);
      assert.equal((await owner.get("/api/sales/not-used/receipt")).status, 402);
      assert.equal((await owner.get("/api/regulatory/documents/not-used")).status, 402);
      const dashboard = await raw(owner, "GET", "/dashboard");
      assert.ok([302, 307].includes(dashboard.status));
      assert.match(dashboard.headers.get("location"), /\/subscription/);
      const page = await raw(owner, "GET", "/subscription");
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Your subscription is past due/);
    } finally {
      await server.query("UPDATE subscriptions SET status = 'TRIAL' WHERE tenant_id = ?", sunrise.tenantId);
    }
  });

  test("Web365 can create a pharmacy for a customer; the owner chooses their own password from the email", async () => {
    const ops = await platformSession(PLATFORM_ADMIN);
    const created = await ops.post("/api/platform/tenants", {
      businessName: "Harbour Chemists", businessEmail: "info@harbour.ng", businessPhone: "0802 000 1111", ownerName: "Chidi Eze", ownerEmail: "chidi@harbour.ng",
      ownerPhone: "0802 000 2222", address: "3 Wharf Road, Apapa", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos", planId: "professional", billingCycle: "ANNUAL",
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.setupEmail, "SENT");
    const message = server.outbox().filter((entry) => entry.to === "chidi@harbour.ng" && entry.subject.includes("account is ready")).at(-1);
    const token = message.text.match(/reset-password\?token=([a-f0-9]+)/)[1];
    const set = await fetch(`${server.baseUrl}/api/auth/password/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: "Harbour2026" }) });
    assert.equal(set.status, 200);
    const owner = new Client(server.baseUrl);
    assert.equal(await owner.login("chidi@harbour.ng", "HQ", "Harbour2026"), null);
    assert.deepEqual([(await owner.session()).user.tenantName, (await owner.session()).user.role], ["Harbour Chemists", "SUPER_ADMIN"]);
  });

  test("Platform Support can look but not manage", async () => {
    const support = await platformSession(PLATFORM_SUPPORT);
    assert.equal((await support.get("/api/platform/tenants")).status, 200);
    assert.equal((await support.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "suspend", reason: "Not allowed to do this" })).status, 403);
    assert.equal((await support.post("/api/platform/users", { name: "New Person", email: "new@web365.ng", role: "PLATFORM_SUPER_ADMIN" })).status, 403);
    assert.equal((await raw(support, "GET", "/platform/staff")).status, 307);
  });

  test("Platform Super Admins manage platform staff; the last Super Admin cannot be suspended by mistake", async () => {
    const ops = await platformSession(PLATFORM_ADMIN);
    const created = await ops.post("/api/platform/users", { name: "Kemi Ade", email: "Kemi@Web365.ng", role: "PLATFORM_SUPPORT" });
    assert.equal(created.status, 201);
    const kemi = await platformSession({ email: "kemi@web365.ng", password: created.data.temporaryPassword });
    assert.equal((await kemi.get("/api/platform/tenants")).status, 200);
    assert.equal((await ops.patch(`/api/platform/users/${created.data.id}`, { status: "SUSPENDED" })).status, 200);
    assert.equal((await kemi.get("/api/platform/tenants")).status, 401, "a suspended platform account loses access at once");
    assert.equal((await ops.patch("/api/platform/users/puser-admin", { status: "SUSPENDED" })).status, 400, "not your own account");
  });
});

describe("Support access: requested by Web365, approved by the pharmacy, read-only, audited", () => {
  let grantId;

  test("the request reaches the pharmacy's Super Admin, and cannot be used before approval", async () => {
    const support = await platformSession(PLATFORM_SUPPORT);
    assert.equal((await support.post("/api/platform/tenants/tenant-demo/support", { reason: "short", minutes: 60 })).status, 400);
    const requested = await support.post("/api/platform/tenants/tenant-demo/support", { reason: "Customer reports wrong stock totals at Lekki", minutes: 60 });
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    grantId = requested.data.id;
    assert.equal((await support.post(`/api/platform/support/${grantId}/open`)).status, 403, "not approved yet");

    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.match(JSON.stringify((await admin.get("/api/notifications")).data), /Web365 support asks for access/);
    const listed = await admin.get("/api/support-access");
    assert.equal(listed.data.grants[0].status, "PENDING");
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    assert.equal((await manager.request("PATCH", "/api/support-access", { grantId, decision: "APPROVED" })).status, 403, "only the Pharmacy Super Admin decides");
    const owner = await sunriseOwner();
    assert.equal((await owner.request("PATCH", "/api/support-access", { grantId, decision: "APPROVED" })).status, 404, "another pharmacy cannot approve it");
  });

  test("once approved, only the requester can open it, and the session is read-only", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const approved = await admin.request("PATCH", "/api/support-access", { grantId, decision: "APPROVED" });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    const ops = await platformSession(PLATFORM_ADMIN);
    assert.equal((await ops.post(`/api/platform/support/${grantId}/open`)).status, 403, "only the person who asked");

    const support = await platformSession(PLATFORM_SUPPORT);
    const opened = await support.post(`/api/platform/support/${grantId}/open`);
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    const session = (await support.session()).user;
    assert.equal(session.tenantId, "tenant-demo");
    assert.equal(session.support.grantId, grantId);
    assert.match(session.name, /Web365 Support \(Bayo Support\)/);
    assert.ok(session.permissions.every((permission) => permission.endsWith(".view") || permission.startsWith("reports.") || permission === "stock.levels"));

    const [product] = await server.query("SELECT name FROM products WHERE tenant_id = 'tenant-demo' ORDER BY seq LIMIT 1");
    assert.match(JSON.stringify((await support.get("/api/products")).data), new RegExp(product.name));
    const alertsBefore = await server.query("SELECT id, status, updated_at FROM inventory_alerts WHERE tenant_id = 'tenant-demo' ORDER BY id");
    const dashboard = await (await raw(support, "GET", "/dashboard")).text();
    assert.match(dashboard, /data-support-banner/);
    assert.ok(!(await (await raw(support, "GET", "/alerts")).text()).includes("__next_error__"));
    assert.deepEqual(await server.query("SELECT id, status, updated_at FROM inventory_alerts WHERE tenant_id = 'tenant-demo' ORDER BY id"), alertsBefore, "viewing pages saved nothing");

    const before = await server.query("SELECT COUNT(*) AS n FROM customers WHERE tenant_id = 'tenant-demo'");
    assert.equal((await support.post("/api/contacts", { kind: "customer", name: "Support Was Here", type: "Walk-in", phone: "", email: "", creditLimit: 0, outletId: null })).status, 403);
    // Allowed by permission (dashboard.view) but it changes data: the database layer refuses it.
    await server.query("INSERT INTO notifications (id, tenant_id, user_id, title, body, severity, created_at, seq) VALUES ('ntf-support-probe', 'tenant-demo', 'support:puser-support', 'Probe', 'Unread', 'info', '2026-11-07T00:00:00Z', 9999)");
    const marked = await support.request("PATCH", "/api/notifications", { ids: ["ntf-support-probe"] });
    assert.equal(marked.status, 403, JSON.stringify(marked.data));
    assert.match(marked.data.error, /Read-only/);
    const [probe] = await server.query("SELECT read_at FROM notifications WHERE id = 'ntf-support-probe'");
    assert.equal(probe.read_at, null, "nothing was saved");
    assert.deepEqual(await server.query("SELECT COUNT(*) AS n FROM customers WHERE tenant_id = 'tenant-demo'"), before);
    assert.equal((await support.get("/api/products?tenant=t-other")).status, 200, "query parameters cannot move the session to another pharmacy");
  });

  test("every step is in the pharmacy's audit trail and the platform's", async () => {
    const pharmacy = (await server.query("SELECT action FROM audit_events WHERE tenant_id = 'tenant-demo' AND entity = 'SupportAccess' ORDER BY seq")).map((row) => row.action);
    assert.deepEqual(pharmacy, ["support.requested", "support.approved", "support.session-started"]);
    const platform = await server.query("SELECT action, actor_type FROM platform_audit_events WHERE target_id = ? ORDER BY at", grantId);
    assert.deepEqual(platform.map((row) => [row.action, row.actor_type]), [["support.request", "platform"], ["support.approved", "pharmacy"], ["support.open", "platform"]]);
  });

  test("the pharmacy can end access at any time, and access ends by itself when it expires", async () => {
    const support = await platformSession(PLATFORM_SUPPORT);
    await support.post(`/api/platform/support/${grantId}/open`);
    assert.equal((await support.get("/api/products")).status, 200);
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await admin.request("PATCH", "/api/support-access", { grantId, decision: "REVOKED" })).status, 200);
    assert.equal((await support.get("/api/products")).status, 401, "revoked");

    const second = await support.post("/api/platform/tenants/tenant-demo/support", { reason: "Follow-up on the stock totals issue", minutes: 30 });
    await admin.request("PATCH", "/api/support-access", { grantId: second.data.id, decision: "APPROVED" });
    await support.post(`/api/platform/support/${second.data.id}/open`);
    assert.equal((await support.get("/api/products")).status, 200);
    await server.query("UPDATE support_access_grants SET expires_at = now() - interval '1 minute' WHERE id = ?", second.data.id);
    assert.equal((await support.get("/api/products")).status, 401, "expired");
  });

  test("the platform audit trail is append-only for the application", async () => {
    await server.query("BEGIN");
    try {
      await server.query("SET LOCAL ROLE pharm_app");
      await assert.rejects(server.query("UPDATE platform_audit_events SET summary = 'tampered'"), (error) => error.code === "42501");
    } finally {
      await server.query("ROLLBACK");
    }
    await server.query("BEGIN");
    try {
      await server.query("SET LOCAL ROLE pharm_app");
      await assert.rejects(server.query("DELETE FROM platform_audit_events"), (error) => error.code === "42501");
    } finally {
      await server.query("ROLLBACK");
    }
  });
});

describe("An existing account joins a second pharmacy only with consent", () => {
  test("added as invited; the pharmacy appears only after the person accepts; their account is untouched", async () => {
    const [relief] = await server.query("SELECT id, name, password, password_hash FROM users WHERE email = 'relief@web365.ng'");
    const owner = await sunriseOwner();
    const [outlet] = await server.query("SELECT id FROM outlets WHERE tenant_id = ?", sunrise.tenantId);
    const added = await owner.post("/api/users", {
      name: "Typed By Owner", email: "relief@web365.ng", phone: "08012345678", role: "CASHIER", outletIds: [outlet.id], primaryOutletId: outlet.id,
      status: "ACTIVE", credential: { mode: "invite" },
    });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    assert.equal(added.data.joinPending, true);
    const [membership] = await server.query("SELECT status, role FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?", sunrise.tenantId, relief.id);
    assert.deepEqual(membership, { status: "INVITED", role: "CASHIER" });

    const ask = async () => (await (await fetch(`${server.baseUrl}/api/auth/pharmacies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "relief@web365.ng", password: "Admin@123" }) })).json()).pharmacies.map((entry) => entry.tenantId).sort();
    assert.deepEqual(await ask(), ["tenant-demo"]);

    const message = server.outbox().filter((entry) => entry.to === "relief@web365.ng" && entry.text.includes("/join?token=")).at(-1);
    const token = message.text.match(/join\?token=([a-f0-9]+)/)[1];
    assert.match(await (await fetch(`${server.baseUrl}/join?token=${token}`)).text(), /Join Sunrise Pharmacy/);
    const joined = await fetch(`${server.baseUrl}/api/auth/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    assert.equal(joined.status, 200);
    assert.deepEqual(await ask(), [sunrise.tenantId, "tenant-demo"].sort());

    const inSunrise = new Client(server.baseUrl);
    assert.equal(await inSunrise.login("relief@web365.ng", outlet.id, "Admin@123", sunrise.tenantId), null);
    assert.equal((await inSunrise.session()).user.role, "CASHIER");
    const [after] = await server.query("SELECT name, password, password_hash FROM users WHERE id = ?", relief.id);
    assert.deepEqual(after, { name: relief.name, password: relief.password, password_hash: relief.password_hash }, "the account itself is unchanged");
    const [demo] = await server.query("SELECT role, status FROM tenant_memberships WHERE tenant_id = 'tenant-demo' AND user_id = ?", relief.id);
    assert.deepEqual(demo, { role: "STAFF", status: "ACTIVE" });
    assert.equal((await fetch(`${server.baseUrl}/api/auth/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })).status, 400, "the link works once");
  });
});
