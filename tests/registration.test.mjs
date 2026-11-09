// SaaS phase 3: self-service pharmacy registration, onboarding, email verification and password recovery.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer({ RATE_LIMIT: "on" });
});
after(async () => {
  await server?.stop();
});

const OWNER = "ngozi.owner@sunrise-pharmacy.ng";
const PASSWORD = "Sunrise2026";

function registration(overrides = {}) {
  return {
    requestId: randomUUID(),
    businessName: "Sunrise Pharmacy",
    businessEmail: "hello@sunrise-pharmacy.ng",
    businessPhone: "0803 123 4567",
    ownerName: "Ngozi Okafor",
    ownerEmail: OWNER,
    ownerPhone: "0809 765 4321",
    address: "12 Allen Avenue, Ikeja",
    country: "NG",
    state: "Lagos",
    currency: "NGN",
    timeZone: "Africa/Lagos",
    password: PASSWORD,
    planId: "professional",
    billingCycle: "MONTHLY",
    ...overrides,
  };
}

const register = async (body) => {
  const response = await fetch(`${server.baseUrl}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
};
const post = (path, body) => fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const lastLink = (to, path) => {
  const message = server.outbox().filter((entry) => entry.to === to && entry.text.includes(path)).at(-1);
  assert.ok(message, `an email to ${to} with a ${path} link`);
  return new URL(message.text.match(new RegExp(`https?://\\S+${path}\\?token=[a-f0-9]+`))[0]);
};

let tenantId;
const first = registration();
let ownerPassword = PASSWORD;

/** Signs the owner in with their own password (signedIn() uses the demo password). */
async function ownerSession() {
  const client = new Client(server.baseUrl);
  const error = await client.login(OWNER, "HQ", ownerPassword);
  assert.equal(error, null, `owner sign-in: ${error}`);
  return client;
}

describe("Public pages", () => {
  test("the sign-in page links to registration and hides the demo shortcuts and their password", async () => {
    const html = await (await fetch(`${server.baseUrl}/login`)).text();
    assert.match(html, /href="\/register"/);
    assert.match(html, /href="\/forgot-password"/);
    assert.ok(!html.includes("Admin@123") && !html.includes("Demo accounts"), "demo shortcuts only appear with NEXT_PUBLIC_DEMO_MODE=1");
  });

  test("the registration page offers the three plans with a free trial", async () => {
    const html = await (await fetch(`${server.baseUrl}/register`)).text();
    for (const plan of ["Starter", "Professional", "Enterprise"]) assert.ok(html.includes(plan), plan);
    assert.match(html, /14(<!-- -->)?-day free trial/);
  });
});

describe("Registration", () => {
  test("creates the pharmacy, its owner, first outlet, settings, role matrix and trial", async () => {
    const { status, data } = await register(first);
    assert.equal(status, 201, JSON.stringify(data));
    assert.equal(data.created, true);
    assert.equal(data.verificationEmail, "SENT");
    tenantId = data.tenantId;
    assert.match(tenantId, /^t-[a-f0-9]{10}$/);

    const [tenant] = await server.query("SELECT name, slug, status, business_email, business_phone, address, country, state, currency, time_zone FROM tenants WHERE id = ?", tenantId);
    assert.deepEqual(tenant, { name: "Sunrise Pharmacy", slug: "sunrise-pharmacy", status: "ACTIVE", business_email: "hello@sunrise-pharmacy.ng", business_phone: "0803 123 4567", address: "12 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN", time_zone: "Africa/Lagos" });
    const [subscription] = await server.query("SELECT plan_id, status, billing_cycle, trial_ends_at FROM subscriptions WHERE tenant_id = ?", tenantId);
    assert.deepEqual([subscription.plan_id, subscription.status, subscription.billing_cycle], ["professional", "TRIAL", "MONTHLY"]);
    const trialDays = (new Date(subscription.trial_ends_at) - Date.now()) / 86_400_000;
    assert.ok(trialDays > 13.9 && trialDays <= 14, `trial of ${trialDays} days`);

    const [owner] = await server.query("SELECT u.id, u.email, u.email_verified_at, u.password, m.role, m.status FROM users u JOIN tenant_memberships m ON m.user_id = u.id WHERE m.tenant_id = ?", tenantId);
    assert.deepEqual([owner.email, owner.role, owner.status, owner.email_verified_at, owner.password], [OWNER, "SUPER_ADMIN", "ACTIVE", null, null]);
    const outlets = await server.query("SELECT name, code, address FROM outlets WHERE tenant_id = ?", tenantId);
    assert.deepEqual(outlets, [{ name: "Sunrise Pharmacy – Main", code: "MAIN", address: "12 Allen Avenue, Ikeja" }]);
    const state = Object.fromEntries((await server.query("SELECT key, value FROM app_state WHERE tenant_id = ?", tenantId)).map((row) => [row.key, JSON.parse(row.value)]));
    assert.equal(state.settings.businessName, "Sunrise Pharmacy");
    assert.ok(state.rolePermissions.SUPER_ADMIN.length > 30, "the pharmacy has its own role matrix");
    const [audit] = await server.query("SELECT action FROM audit_events WHERE tenant_id = ?", tenantId);
    assert.equal(audit.action, "tenant.registered");
    const sent = server.outbox().filter((message) => message.to === OWNER);
    assert.equal(sent.length, 2, "verification and trial-started emails");
    assert.ok(sent.some((message) => message.text.includes("/verify-email?token=")), "verification email sent");
    assert.ok(sent.some((message) => /trial/i.test(message.subject)), "trial-started email sent");
  });

  test("a retried submission returns the same pharmacy instead of creating another", async () => {
    const { status, data } = await register(first);
    assert.equal(status, 200);
    assert.deepEqual([data.tenantId, data.created], [tenantId, false]);
    const [{ n }] = await server.query("SELECT COUNT(*) AS n FROM tenants WHERE name = 'Sunrise Pharmacy'");
    assert.equal(n, 1);
  });

  test("an email that already has an account cannot register again, and weak input is refused", async () => {
    assert.equal((await register(registration())).status, 409, "same owner email, new form");
    assert.equal((await register(registration({ ownerEmail: "admin@web365.ng" }))).status, 409, "an email used by another pharmacy");
    const weak = await register(registration({ ownerEmail: "weak@sunrise.ng", password: "password" }));
    assert.equal(weak.status, 422);
    assert.match(weak.data.error, /number/);
    assert.equal((await register(registration({ ownerEmail: "state@sunrise.ng", state: "Atlantis" }))).status, 422);
    assert.equal((await register(registration({ ownerEmail: "plan@sunrise.ng", planId: "platinum" }))).status, 400);
    const [{ n }] = await server.query("SELECT COUNT(*) AS n FROM tenants");
    assert.equal(n, 2, "only the demo pharmacy and Sunrise exist");
  });
});

describe("The new owner", () => {
  test("signs in straight into their own, empty pharmacy and sees the setup checklist", async () => {
    const owner = await ownerSession();
    const session = (await owner.session()).user;
    assert.deepEqual([session.tenantId, session.tenantName, session.role], [tenantId, "Sunrise Pharmacy", "SUPER_ADMIN"]);
    const products = await owner.get("/api/products");
    assert.equal(products.status, 200);
    assert.ok(!JSON.stringify(products.data).includes("Paracetamol"), "no demo products");

    // React separates text parts with <!-- --> markers in server HTML.
    const checklist = (await owner.request("GET", "/onboarding?welcome=1", undefined, { raw: true }).then((response) => response.text())).replaceAll("<!-- -->", "");
    assert.match(checklist, /Welcome to Sunrise Pharmacy/);
    assert.match(checklist, /data-step="verify-email" data-done="false"/);
    assert.match(checklist, /data-step="profile" data-done="true"/);
    assert.match(checklist, /data-step="products" data-done="false"/);
    assert.match(checklist, /Professional · free trial, 14 days left/);
    const dashboard = await owner.request("GET", "/dashboard", undefined, { raw: true }).then((response) => response.text());
    assert.match(dashboard, /data-setup-banner/);
  });

  test("confirms the email with the emailed link (a button press, used once)", async () => {
    const link = lastLink(OWNER, "/verify-email");
    const page = await (await fetch(`${server.baseUrl}${link.pathname}${link.search}`)).text();
    assert.match(page, /Confirm my email/);
    const token = link.searchParams.get("token");
    assert.equal((await post("/api/auth/verify-email", { token })).status, 200);
    const [owner] = await server.query("SELECT email_verified_at FROM users WHERE email = ?", OWNER);
    assert.ok(owner.email_verified_at);
    assert.equal((await post("/api/auth/verify-email", { token })).status, 400, "a link works once");
    assert.equal((await post("/api/auth/verify-email", { token: "0".repeat(64) })).status, 400);

    const client = await ownerSession();
    const checklist = await client.request("GET", "/onboarding", undefined, { raw: true }).then((response) => response.text());
    assert.match(checklist, /data-step="verify-email" data-done="true"/);
    assert.equal((await client.post("/api/account/verify-email")).status, 400, "nothing to resend");
  });

  test("updates the business profile of their own pharmacy only; others cannot", async () => {
    const owner = await ownerSession();
    const profile = { businessName: "Sunrise Pharmacy Ltd", businessEmail: "info@sunrise-pharmacy.ng", businessPhone: "0803 123 9999", address: "14 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos" };
    const saved = await owner.request("PATCH", "/api/tenant/profile", profile);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const [tenant] = await server.query("SELECT name, business_phone FROM tenants WHERE id = ?", tenantId);
    assert.deepEqual(tenant, { name: "Sunrise Pharmacy Ltd", business_phone: "0803 123 9999" });
    assert.equal((await owner.session()).user.tenantName, "Sunrise Pharmacy Ltd");

    const cashier = await signedIn(server.baseUrl, "relief@web365.ng", "outlet-1");
    assert.equal((await cashier.request("PATCH", "/api/tenant/profile", { ...profile, businessName: "Hijacked" })).status, 403);
    const [demo] = await server.query("SELECT name FROM tenants WHERE id = 'tenant-demo'");
    assert.notEqual(demo.name, "Hijacked");
  });
});

describe("Password recovery", () => {
  test("the answer never reveals whether an email has an account", async () => {
    const known = await (await post("/api/auth/password/forgot", { email: OWNER })).json();
    const unknown = await (await post("/api/auth/password/forgot", { email: "nobody@nowhere.ng" })).json();
    assert.deepEqual(known, unknown);
    assert.equal(server.outbox().filter((message) => message.to === "nobody@nowhere.ng").length, 0);
  });

  test("a reset link sets a new password once and signs out every existing session", async () => {
    const session = await ownerSession();
    assert.equal((await session.get("/api/products")).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // the change must be at least one second after sign-in
    const mobile = await (await post("/api/mobile/login", { identifier: OWNER, password: PASSWORD, outletId: "HQ" })).json();
    assert.ok(mobile.token);

    const token = lastLink(OWNER, "/reset-password").searchParams.get("token");
    const weak = await post("/api/auth/password/reset", { token, password: "short" });
    assert.equal(weak.status, 422, "a weak password does not use up the link");
    assert.match(await (await fetch(`${server.baseUrl}/reset-password?token=${token}`)).text(), /Set new password/);
    assert.equal((await post("/api/auth/password/reset", { token, password: "NewSunrise2026" })).status, 200);
    ownerPassword = "NewSunrise2026";
    assert.equal((await post("/api/auth/password/reset", { token, password: "Another2026x" })).status, 400, "used once");

    assert.equal((await session.get("/api/products")).status, 401, "the browser session is signed out");
    const mobileCall = await fetch(`${server.baseUrl}/api/dashboard`, { headers: { Authorization: `Bearer ${mobile.token}` } });
    assert.equal(mobileCall.status, 401, "the mobile token is revoked");
    assert.ok(await new Client(server.baseUrl).login(OWNER, "HQ", PASSWORD), "the old password no longer works");
    const fresh = new Client(server.baseUrl);
    assert.equal(await fresh.login(OWNER, "HQ", "NewSunrise2026"), null);
    assert.equal((await fresh.get("/api/products")).status, 200);
    const [audit] = await server.query("SELECT tenant_id FROM audit_events WHERE action = 'auth.password-reset'");
    assert.equal(audit.tenant_id, tenantId);
  });

  test("an administrator's password reset also signs the user out everywhere", async () => {
    const relief = await signedIn(server.baseUrl, "relief@web365.ng", "outlet-1");
    assert.equal((await relief.get("/api/dashboard")).status, 200);
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const [user] = await server.query("SELECT id FROM users WHERE email = 'relief@web365.ng'");
    await new Promise((resolve) => setTimeout(resolve, 1100)); // the change must be at least one second after sign-in
    const reset = await admin.patch(`/api/users/${user.id}`, { action: "reset-password" });
    assert.equal(reset.status, 200, JSON.stringify(reset.data));
    assert.equal((await relief.get("/api/dashboard")).status, 401);
  });
});
