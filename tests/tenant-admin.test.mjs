// SaaS phase 7C: pharmacy administration in the Control Centre: search and filters, editing details, people,
// outlets and activity, manual subscription adjustments with a ledger, the grace period, new plans,
// authorised refunds through Paystack (a local stand-in) and account closure requests.
import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startFakePaystack } from "./helpers/fake-paystack.mjs";
import { startServer } from "./helpers/server.mjs";

const SECRET = "sk_test_tenantadmin0123456789abcdef";
const PASSWORD = "Tenant-Admin-2026";
const STAFF = {
  super: { id: "p-super", email: "super@web365.ng", role: "PLATFORM_SUPER_ADMIN" },
  support: { id: "p-support", email: "support@web365.ng", role: "PLATFORM_SUPPORT" },
  billing: { id: "p-billing", email: "billing@web365.ng", role: "BILLING_ADMIN" },
  billing2: { id: "p-billing2", email: "billing2@web365.ng", role: "BILLING_ADMIN" },
  technical: { id: "p-tech", email: "tech@web365.ng", role: "TECHNICAL_ADMIN" },
};
const OWNER = { email: "ngozi@sunrise.ng", password: "Sunrise2026" };

let server;
let paystack;
let sunrise;
let moonlight;

async function register(fields) {
  const response = await fetch(`${server.baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(), businessPhone: "0803 123 4567", ownerPhone: "0809 765 4321", address: "12 Allen Avenue, Ikeja", country: "NG", state: "Lagos",
      currency: "NGN", timeZone: "Africa/Lagos", planId: "professional", billingCycle: "MONTHLY", ...fields,
    }),
  });
  const text = await response.text();
  assert.equal(response.status, 201, text);
  return JSON.parse(text);
}

before(async () => {
  paystack = await startFakePaystack(SECRET);
  server = await startServer({ PAYSTACK_SECRET_KEY: SECRET, PAYSTACK_BASE_URL: paystack.url });
  for (const person of Object.values(STAFF)) {
    const salt = randomBytes(16).toString("hex");
    await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", person.id, person.email, person.id, person.role, `${salt}:${pbkdf2Sync(PASSWORD, salt, 310000, 32, "sha256").toString("hex")}`);
  }
  await server.query("UPDATE plans SET monthly_price = 30000, annual_price = 300000 WHERE id = 'professional'");
  sunrise = await register({ businessName: "Sunrise Pharmacy", businessEmail: "hello@sunrise.ng", ownerName: "Ngozi Okafor", ownerEmail: OWNER.email, password: OWNER.password });
  moonlight = await register({ businessName: "Moonlight Chemists", businessEmail: "desk@moonlight.ng", ownerName: "Tunde Bello", ownerEmail: "tunde@moonlight.ng", password: "Moonlight2026", state: "Oyo", planId: "starter" });
});
after(async () => {
  await server?.stop();
  await paystack?.close();
});

async function as(person) {
  const client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/platform/login", { email: person.email, password: PASSWORD })).status, 200);
  return client;
}
async function owner() {
  const client = new Client(server.baseUrl);
  assert.equal(await client.login(OWNER.email, "HQ", OWNER.password), null);
  return client;
}
const page = (client, path) => client.request("GET", path, undefined, { raw: true });
const patch = (client, body, tenantId = sunrise.tenantId) => client.patch(`/api/platform/tenants/${tenantId}`, body);
const subscription = async () => (await server.query("SELECT status, plan_id, billing_cycle, trial_ends_at, current_period_end, cancel_at_period_end FROM subscriptions WHERE tenant_id = ?", sunrise.tenantId))[0];
const setPolicy = async (value) => assert.equal((await (await as(STAFF.billing)).request("PUT", "/api/platform/settings/subscriptions.policy", { value })).status, 200);
async function rejectedForApp(statement) {
  await server.query("BEGIN");
  try {
    await server.query("SET LOCAL ROLE pharm_app");
    await assert.rejects(server.query(statement), (error) => error.code === "42501", statement);
  } finally {
    await server.query("ROLLBACK");
  }
}

describe("Finding pharmacies", () => {
  test("search matches name, slug and any member's email; filters narrow by status, subscription and plan", async () => {
    const support = await as(STAFF.support);
    const names = async (query) => (await support.get(`/api/platform/tenants?${query}`)).data.tenants.map((tenant) => tenant.name).sort();
    assert.deepEqual(await names("q=moon"), ["Moonlight Chemists"]);
    assert.deepEqual((await support.get("/api/platform/tenants?q=moon")).data.tenants.map((tenant) => tenant.id), [moonlight.tenantId]);
    assert.deepEqual(await names("q=NGOZI%40sunrise"), ["Sunrise Pharmacy"], "a member's email, any case");
    assert.deepEqual(await names("q=desk%40moonlight"), ["Moonlight Chemists"], "the business email");
    assert.deepEqual(await names("q=%25"), [], "LIKE wildcards are taken literally");
    assert.deepEqual(await names("plan=starter&q=chem"), ["Moonlight Chemists"]);
    assert.deepEqual(await names("subscription=TRIAL&q=sunrise"), ["Sunrise Pharmacy"]);
    assert.deepEqual(await names("status=SUSPENDED"), []);
    const html = await (await page(support, "/platform/tenants?q=moon")).text();
    assert.match(html, /data-tenant-filters/);
    assert.match(html, /Moonlight Chemists/);
    assert.ok(!html.includes(">Sunrise Pharmacy<"), "the filtered page leaves the others out");
  });
});

describe("Pharmacy details", () => {
  test("Super Admins correct the details; it is validated, audited, and the pharmacy's own name follows", async () => {
    const admin = await as(STAFF.super);
    const profile = { businessName: "Sunrise Pharmacy Ikeja", businessEmail: "accounts@sunrise.ng", businessPhone: "0803 123 4567", address: "14 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos" };
    assert.equal((await patch(await as(STAFF.billing), { action: "update-profile", profile })).status, 403, "billing admins cannot");
    assert.equal((await patch(admin, { action: "update-profile", profile: { ...profile, state: "Atlantis" } })).status, 422);
    const saved = await patch(admin, { action: "update-profile", profile });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const [tenant] = await server.query("SELECT name, business_email, address FROM tenants WHERE id = ?", sunrise.tenantId);
    assert.deepEqual(tenant, { name: "Sunrise Pharmacy Ikeja", business_email: "accounts@sunrise.ng", address: "14 Allen Avenue, Ikeja" });
    const [settings] = await server.query("SELECT value FROM app_state WHERE tenant_id = ? AND key = 'settings'", sunrise.tenantId);
    assert.equal(JSON.parse(settings.value).businessName, "Sunrise Pharmacy Ikeja");
    const [audit] = await server.query("SELECT summary FROM platform_audit_events WHERE action = 'tenant.update-profile'");
    assert.match(audit.summary, /email: "hello@sunrise.ng" → "accounts@sunrise.ng"/);
  });

  test("the page lists people, outlets and activity counts, but no business records", async () => {
    await owner(); // a sign-in to count
    const html = await (await page(await as(STAFF.support), `/platform/tenants/${sunrise.tenantId}`)).text();
    assert.match(html, /data-tenant-people/);
    assert.match(html, /ngozi@sunrise\.ng/);
    assert.match(html, /Sunrise Pharmacy – Main/);
    assert.match(html, /data-tenant-activity/);
    assert.match(html, /[1-9]\d*(<!-- -->)? sign-ins/);
    assert.ok(!html.includes("data-subscription-adjustments") && !html.includes("data-profile-editor"), "support staff get no change controls");
  });
});

describe("Subscription adjustments", () => {
  test("every change needs the billing permission and a reason, and is kept with the values before and after", async () => {
    const billing = await as(STAFF.billing);
    assert.equal((await patch(await as(STAFF.support), { action: "extend-trial", days: 7, reason: "Goodwill gesture" })).status, 403);
    assert.equal((await patch(await as(STAFF.technical), { action: "extend-trial", days: 7, reason: "Goodwill gesture" })).status, 403);
    const missing = await patch(billing, { action: "extend-trial", days: 7 });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /reason/i);
    const before = await subscription();
    const extended = await patch(billing, { action: "extend-trial", days: 7, reason: "Onboarding call ran late" });
    assert.equal(extended.status, 200, JSON.stringify(extended.data));
    assert.equal(Math.round((new Date((await subscription()).trial_ends_at) - new Date(before.trial_ends_at)) / 86_400_000), 7);
    assert.equal((await patch(billing, { action: "extend-period", days: 5, reason: "Not paid yet" })).status, 400, "a trial has no paid period");
    const [entry] = await server.query("SELECT kind, actor_name, reason, before, after FROM subscription_adjustments WHERE tenant_id = ?", sunrise.tenantId);
    assert.deepEqual([entry.kind, entry.actor_name, entry.reason, entry.before.status, entry.after.status], ["extend-trial", "p-billing", "Onboarding call ran late", "TRIAL", "TRIAL"]);
    assert.notEqual(entry.before.trialEndsAt, entry.after.trialEndsAt);
    const html = await (await page(billing, `/platform/tenants/${sunrise.tenantId}`)).text();
    assert.match(html, /Reason: Onboarding call ran late/);
  });

  test("the ledger cannot be edited or deleted by the application", async () => {
    await rejectedForApp("UPDATE subscription_adjustments SET reason = 'x'");
    await rejectedForApp("DELETE FROM subscription_adjustments");
  });
});

describe("Plans", () => {
  test("new plans start hidden from registration; ids are checked and permanent", async () => {
    const billing = await as(STAFF.billing);
    const plan = { name: "Clinic", description: "", monthlyPrice: null, annualPrice: null, currency: "NGN", trialDays: 14, maxOutlets: 2, maxStaffAccounts: 5, features: null, isActive: true, isPublic: false, sortOrder: 9 };
    assert.equal((await (await as(STAFF.support)).post("/api/platform/plans", { id: "clinic", plan })).status, 403);
    assert.equal((await billing.post("/api/platform/plans", { id: "9 bad", plan })).status, 422);
    assert.equal((await billing.post("/api/platform/plans", { id: "clinic", plan })).status, 201);
    assert.equal((await billing.post("/api/platform/plans", { id: "clinic", plan })).status, 409);
    const [row] = await server.query("SELECT name, is_public, max_outlets FROM plans WHERE id = 'clinic'");
    assert.deepEqual(row, { name: "Clinic", is_public: false, max_outlets: 2 });
    const registration = await (await fetch(`${server.baseUrl}/register`)).text();
    assert.ok(!registration.includes(">Clinic<"), "not offered to new pharmacies");
  });
});

describe("Refunds", () => {
  let reference;
  let paymentId;
  const sign = (body) => createHmac("sha512", SECRET).update(body).digest("hex");
  async function webhook(event) {
    const body = JSON.stringify(event);
    const response = await fetch(`${server.baseUrl}/api/billing/webhooks/paystack`, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": sign(body) }, body });
    return { status: response.status, data: await response.json() };
  }
  const refunds = () => server.query("SELECT id, amount, status, provider_refund_id, last_error, requested_by, decided_by FROM billing_refunds ORDER BY requested_at");
  const request = (client, amount, reason = "Charged twice by mistake") => client.post("/api/platform/refunds", { paymentId, amount, reason });

  before(async () => {
    const started = await (await owner()).post("/api/billing/checkout", { planId: "professional", billingCycle: "MONTHLY" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    reference = started.data.reference;
    paystack.succeed(reference);
    assert.equal((await webhook({ event: "charge.success", data: { id: "evt-1", reference, status: "success" } })).data.result, "activated");
    [{ id: paymentId }] = await server.query("SELECT id FROM billing_payments WHERE reference = ?", reference);
  });

  test("a refund needs a reason, cannot exceed what was paid, and a second person must approve it", async () => {
    const billing = await as(STAFF.billing);
    assert.equal((await (await as(STAFF.support)).post("/api/platform/refunds", { paymentId, amount: 100, reason: "Not allowed" })).status, 403);
    assert.equal((await request(billing, 100, "no")).status, 422);
    const tooMuch = await request(billing, 30000.01);
    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.data.error, /30000\.00/);
    const created = await request(billing, 10000);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.refund.status, "REQUESTED");
    assert.equal(paystack.state.refunds.size, 0, "nothing is sent before approval");
    const own = await billing.post(`/api/platform/refunds/${created.data.refund.id}`, { decision: "approve" });
    assert.equal(own.status, 403);
    assert.match(own.data.error, /second billing administrator/);
    const approved = await (await as(STAFF.billing2)).post(`/api/platform/refunds/${created.data.refund.id}`, { decision: "approve", note: "Checked the duplicate" });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.refund.status, "PENDING");
    const sent = [...paystack.state.refunds.values()].at(-1);
    assert.deepEqual([sent.transaction, sent.amount, sent.currency], [reference, 1_000_000, "NGN"]);
    const remaining = await request(billing, 20000.01);
    assert.equal(remaining.status, 400, "the pending refund still counts");
  });

  test("Paystack's webhook prompts a check; the refund and invoice are updated from Paystack's answer", async () => {
    const [refund] = await refunds();
    paystack.state.refunds.get(refund.provider_refund_id).status = "processed";
    const result = await webhook({ event: "refund.processed", data: { status: "processed", transaction_reference: reference, refund_reference: "rf-1", amount: 1 } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal((await refunds())[0].status, "PROCESSED");
    const [invoice] = await server.query("SELECT status FROM invoices WHERE payment_id = ?", paymentId);
    assert.equal(invoice.status, "PARTIALLY_REFUNDED");
    assert.equal((await webhook({ event: "refund.processed", data: { status: "processed", transaction_reference: reference, refund_reference: "rf-1" } })).data.duplicate, true);
  });

  test("a rejected or refused refund frees the amount; an unreachable provider keeps it reserved for a person to check", async () => {
    const billing = await as(STAFF.billing);
    const second = await as(STAFF.billing2);
    const rejected = (await request(billing, 5000)).data.refund;
    assert.equal((await second.post(`/api/platform/refunds/${rejected.id}`, { decision: "reject" })).status, 400, "a reason is needed");
    assert.equal((await second.post(`/api/platform/refunds/${rejected.id}`, { decision: "reject", note: "Customer kept using it" })).data.refund.status, "REJECTED");

    paystack.state.refundError = "Refund amount cannot be greater than transaction amount";
    const refused = (await request(billing, 5000)).data.refund;
    const outcome = await second.post(`/api/platform/refunds/${refused.id}`, { decision: "approve" });
    assert.equal(outcome.data.refund.status, "FAILED");
    assert.match(outcome.data.refund.error, /cannot be greater/);
    paystack.state.refundError = null;

    paystack.state.refundUnreachable = true;
    const unknown = (await request(billing, 5000)).data.refund;
    const lost = await second.post(`/api/platform/refunds/${unknown.id}`, { decision: "approve" });
    assert.equal(lost.data.refund.status, "PENDING", "not marked failed: it may have gone through");
    assert.match(lost.data.refund.error, /Paystack dashboard/);
    paystack.state.refundUnreachable = false;
    const [critical] = await server.query("SELECT severity FROM platform_audit_events WHERE action = 'billing.refund-unknown'");
    assert.equal(critical.severity, "critical");
    assert.equal((await request(billing, 15000.01)).status, 400, "20,000 left minus the 5,000 that may have gone");
  });

  test("with one-person approval a refund is sent straight away", async () => {
    await setPolicy({ graceDays: 3, refundApproval: "single", closedRetentionDays: 90 });
    const result = await request(await as(STAFF.billing), 1000, "Small goodwill refund");
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.refund.status, "PENDING");
    await setPolicy({ graceDays: 3, refundApproval: "two_person", closedRetentionDays: 90 });
  });

  test("refund records cannot be deleted by the application", async () => {
    await rejectedForApp("DELETE FROM billing_refunds");
    await rejectedForApp("DELETE FROM tenant_deletion_requests");
  });
});

describe("Grace period", () => {
  const dashboard = async () => (await (await owner()).get("/api/dashboard")).status;

  test("a lapsed paid period keeps working for the policy's grace days, then stops", async () => {
    await server.query("UPDATE subscriptions SET status = 'ACTIVE', cancel_at_period_end = false, current_period_end = now() - interval '1 day' WHERE tenant_id = ?", sunrise.tenantId);
    assert.equal(await dashboard(), 200, "inside the 3 default grace days");
    const html = await (await (await owner()).request("GET", "/subscription", undefined, { raw: true })).text();
    assert.match(html, /data-subscription-grace/);
    await server.query("UPDATE subscriptions SET current_period_end = now() - interval '4 days' WHERE tenant_id = ?", sunrise.tenantId);
    assert.equal(await dashboard(), 402, "after the grace days");
    await setPolicy({ graceDays: 7, refundApproval: "two_person", closedRetentionDays: 90 });
    assert.equal(await dashboard(), 200, "the policy is read fresh");
    await server.query("UPDATE subscriptions SET cancel_at_period_end = true WHERE tenant_id = ?", sunrise.tenantId);
    assert.equal(await dashboard(), 402, "no grace for a cancelled subscription");
    await setPolicy({ graceDays: 0, refundApproval: "two_person", closedRetentionDays: 90 });
    await server.query("UPDATE subscriptions SET cancel_at_period_end = false WHERE tenant_id = ?", sunrise.tenantId);
    assert.equal(await dashboard(), 402, "0 grace days");
  });

  test("Web365 can add free days to a paid period", async () => {
    const billing = await as(STAFF.billing);
    const result = await patch(billing, { action: "extend-period", days: 10, reason: "Compensation for the outage" });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const after = await subscription();
    assert.equal(after.status, "ACTIVE");
    assert.equal(Math.round((new Date(after.current_period_end) - Date.now()) / 86_400_000), 10, "from today, as the period had lapsed");
    assert.equal(await dashboard(), 200);
    await setPolicy({ graceDays: 3, refundApproval: "two_person", closedRetentionDays: 90 });
  });
});

describe("Closing an account", () => {
  const closure = (client, body) => client.post("/api/tenant/closure", body);

  test("only the Super Admin can ask, confirming with their password; the demo cannot be closed", async () => {
    const client = await owner();
    assert.equal((await closure(client, { reason: "Retiring", password: "wrong-password" })).status, 403);
    assert.equal((await closure(client, { reason: "x", password: OWNER.password })).status, 400);
    const demo = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await closure(demo, { reason: "Trying it out", password: "x" })).status, 403);
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    assert.ok([403].includes((await closure(manager, { reason: "Not mine", password: "x" })).status));
  });

  test("a request can be withdrawn; Web365 sees it, and declining tells the owner why", async () => {
    const client = await owner();
    assert.equal((await closure(client, { reason: "We are moving to another system", password: OWNER.password })).status, 201);
    assert.equal((await closure(client, { reason: "Again", password: OWNER.password })).status, 409);
    const support = await as(STAFF.support);
    assert.deepEqual((await support.get("/api/platform/tenants?deletion=1")).data.tenants.map((tenant) => tenant.id), [sunrise.tenantId]);
    assert.equal((await client.request("DELETE", "/api/tenant/closure")).status, 200);
    assert.equal((await support.get("/api/platform/tenants?deletion=1")).data.tenants.length, 0);

    await closure(client, { reason: "We are moving to another system", password: OWNER.password });
    const [open] = await server.query("SELECT id FROM tenant_deletion_requests WHERE tenant_id = ? AND status = 'REQUESTED'", sunrise.tenantId);
    assert.equal((await patch(support, { action: "closure", requestId: open.id, decision: "reject", note: "Please call us first" })).status, 403);
    const admin = await as(STAFF.super);
    assert.equal((await patch(admin, { action: "closure", requestId: open.id, decision: "reject" })).status, 400);
    assert.equal((await patch(admin, { action: "closure", requestId: open.id, decision: "reject", note: "Please settle the open invoice first" })).status, 200);
    const mail = server.outbox().filter((message) => message.to === OWNER.email).at(-1);
    assert.match(mail.subject, /About your request to close/);
    assert.match(mail.text, /settle the open invoice/);
    assert.equal((await patch(admin, { action: "closure", requestId: open.id, decision: "approve" })).status, 409, "already decided");
  });

  test("approval closes the pharmacy, cancels the subscription and keeps the data until the purge date", async () => {
    const client = await owner();
    await closure(client, { reason: "We are moving to another system", password: OWNER.password });
    const [open] = await server.query("SELECT id FROM tenant_deletion_requests WHERE tenant_id = ? AND status = 'REQUESTED'", sunrise.tenantId);
    const html = await (await page(await as(STAFF.super), `/platform/tenants/${sunrise.tenantId}`)).text();
    assert.match(html, /data-closure="REQUESTED"/);
    const result = await patch(await as(STAFF.super), { action: "closure", requestId: open.id, decision: "approve" });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const [tenant] = await server.query("SELECT status, status_reason, purge_after FROM tenants WHERE id = ?", sunrise.tenantId);
    assert.equal(tenant.status, "CLOSED");
    assert.match(tenant.status_reason, /owner's request/);
    assert.equal(Math.round((new Date(tenant.purge_after) - Date.now()) / 86_400_000), 90);
    assert.equal((await subscription()).status, "CANCELLED");
    const [ledger] = await server.query("SELECT kind FROM subscription_adjustments WHERE tenant_id = ? ORDER BY at DESC LIMIT 1", sunrise.tenantId);
    assert.equal(ledger.kind, "close");
    assert.match(server.outbox().filter((message) => message.to === OWNER.email).at(-1).subject, /has been closed/);
    assert.ok((await server.query("SELECT count(*)::int AS n FROM outlets WHERE tenant_id = ?", sunrise.tenantId))[0].n > 0, "the data is kept");
    const login = await new Client(server.baseUrl).login(OWNER.email, "HQ", OWNER.password);
    assert.notEqual(login, null, "nobody can sign in to a closed pharmacy");
    assert.equal((await patch(await as(STAFF.billing), { action: "extend-period", days: 5, reason: "Should not work now" })).status, 400);
  });
});
