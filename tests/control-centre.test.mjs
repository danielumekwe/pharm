// SaaS phase 7A: Web365 Platform Control Centre: roles, encrypted settings, payment gateway settings,
// dashboard figures and health. The server starts WITHOUT Paystack keys in its environment.
import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { startFakePaystack } from "./helpers/fake-paystack.mjs";
import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const TEST_SECRET = "sk_test_controlcentre0123456789abcdef";
const TEST_PUBLIC = "pk_test_publicvalue9876543210zyxwvu";
const CRON_SECRET = "cron-secret-for-control-centre";
const STAFF = {
  super: { id: "p-super", email: "super@web365.ng", role: "PLATFORM_SUPER_ADMIN" },
  support: { id: "p-support", email: "support@web365.ng", role: "PLATFORM_SUPPORT" },
  billing: { id: "p-billing", email: "billing@web365.ng", role: "BILLING_ADMIN" },
  technical: { id: "p-tech", email: "tech@web365.ng", role: "TECHNICAL_ADMIN" },
};
const PASSWORD = "Control-Centre-2026";

let server;
let paystack;

before(async () => {
  paystack = await startFakePaystack(TEST_SECRET);
  server = await startServer({ PAYSTACK_BASE_URL: paystack.url, CRON_SECRET });
  for (const person of Object.values(STAFF)) {
    const salt = randomBytes(16).toString("hex");
    await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", person.id, person.email, person.role, person.role, `${salt}:${pbkdf2Sync(PASSWORD, salt, 310000, 32, "sha256").toString("hex")}`);
  }
  await server.query("UPDATE plans SET monthly_price = 30000, annual_price = 300000 WHERE id = 'professional'");
  const response = await fetch(`${server.baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(), businessName: "Sunrise Pharmacy", businessEmail: "hello@sunrise.ng", businessPhone: "0803 123 4567", ownerName: "Ngozi Okafor",
      ownerEmail: "ngozi@sunrise.ng", ownerPhone: "0809 765 4321", address: "12 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN",
      timeZone: "Africa/Lagos", password: "Sunrise2026", planId: "professional", billingCycle: "MONTHLY",
    }),
  });
  assert.equal(response.status, 201, await response.text());
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
  assert.equal(await client.login("ngozi@sunrise.ng", "HQ", "Sunrise2026"), null);
  return client;
}
const page = (client, path) => client.request("GET", path, undefined, { raw: true });
const save = (client, body) => client.request("PUT", "/api/platform/settings/payments.paystack", body);

describe("Control Centre access", () => {
  test("every platform role sees the dashboard; only billing roles see the payment gateway", async () => {
    for (const [name, person] of Object.entries(STAFF)) {
      const client = await as(person);
      assert.equal((await page(client, "/platform")).status, 200, `${name} dashboard`);
      const gateway = await page(client, "/platform/settings/payments");
      const api = await client.get("/api/platform/settings/payments.paystack");
      const allowed = name === "super" || name === "billing";
      assert.equal(gateway.status, allowed ? 200 : 307, `${name} gateway page`);
      assert.equal(api.status, allowed ? 200 : 403, `${name} gateway API`);
    }
  });

  test("pharmacy accounts, even a Pharmacy Super Admin, reach none of it", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await admin.get("/api/platform/settings/payments.paystack")).status, 401);
    assert.equal((await save(admin, { value: { enabled: true } })).status, 401);
    assert.equal((await page(admin, "/platform/settings/payments")).status, 307);
  });
});

describe("Encrypted settings", () => {
  test("a saved secret key is never returned, shown, logged or stored in plain text", async () => {
    const billing = await as(STAFF.billing);
    const saved = await save(billing, { value: { enabled: true, mode: "test", testPublicKey: TEST_PUBLIC }, secrets: { testSecretKey: TEST_SECRET } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.secrets.testSecretKey, { set: true, hint: `•••• ${TEST_SECRET.slice(-4)}` });
    assert.deepEqual(saved.data.secrets.liveSecretKey, { set: false, hint: null });
    const everywhere = [JSON.stringify(saved.data), JSON.stringify((await billing.get("/api/platform/settings/payments.paystack")).data), await (await page(billing, "/platform/settings/payments")).text()];
    const [row] = await server.query("SELECT value::text AS value, secret_ciphertext FROM platform_settings WHERE key = 'payments.paystack'");
    const history = await server.query("SELECT changes::text AS changes FROM platform_settings_history");
    const audit = await server.query("SELECT summary FROM platform_audit_events WHERE action = 'settings.update'");
    everywhere.push(row.value, row.secret_ciphertext, ...history.map((entry) => entry.changes), ...audit.map((entry) => entry.summary), server.logs());
    for (const text of everywhere) assert.ok(!text.includes(TEST_SECRET) && !text.includes(TEST_SECRET.slice(8, 30)), "the secret leaked");
    assert.match(row.secret_ciphertext, /^v1:/);
    assert.match(history[0].changes, /testSecretKey set/);
  });

  test("keys are validated, a blank field keeps the saved key, and a key can be removed", async () => {
    const billing = await as(STAFF.billing);
    assert.equal((await save(billing, { secrets: { testSecretKey: "sk_live_wrongmode0123456789" } })).status, 422);
    assert.equal((await save(billing, { value: { livePublicKey: "sk_live_not_a_public_key_123" } })).status, 422);
    assert.equal((await save(billing, { value: { mode: "staging" } })).status, 422);
    assert.equal((await billing.request("PUT", "/api/platform/settings/unknown.thing", {})).status, 404);
    const kept = await save(billing, { value: { currency: "NGN" }, secrets: { testSecretKey: "" } });
    assert.equal(kept.data.secrets.testSecretKey.set, true);
    const removed = await save(billing, { secrets: { liveSecretKey: null } });
    assert.equal(removed.data.secrets.testSecretKey.set, true, "other keys untouched");
  });

  test("the settings history cannot be edited or deleted by the application", async () => {
    for (const statement of ["UPDATE platform_settings_history SET changes = '[]'", "DELETE FROM platform_settings_history"]) {
      await server.query("BEGIN");
      try {
        await server.query("SET LOCAL ROLE pharm_app");
        await assert.rejects(server.query(statement), (error) => error.code === "42501");
      } finally {
        await server.query("ROLLBACK");
      }
    }
  });
});

describe("Payments use the keys from the settings", () => {
  test("checkout and webhooks work with the saved key alone (none in the environment)", async () => {
    const client = await owner();
    const started = await client.post("/api/billing/checkout", { planId: "professional", billingCycle: "MONTHLY" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.equal(paystack.state.requests.at(-1).authorization, `Bearer ${TEST_SECRET}`);
    paystack.succeed(started.data.reference);
    const body = JSON.stringify({ event: "charge.success", data: { id: "evt-cc-1", reference: started.data.reference } });
    const forged = await fetch(`${server.baseUrl}/api/billing/webhooks/paystack`, { method: "POST", headers: { "x-paystack-signature": createHmac("sha512", "sk_test_someoneelse").update(body).digest("hex") }, body });
    assert.equal(forged.status, 401);
    const signed = await fetch(`${server.baseUrl}/api/billing/webhooks/paystack`, { method: "POST", headers: { "x-paystack-signature": createHmac("sha512", TEST_SECRET).update(body).digest("hex") }, body });
    assert.equal((await signed.json()).result, "activated");
  });

  test("turning the gateway off stops new payments", async () => {
    const billing = await as(STAFF.billing);
    await save(billing, { value: { enabled: false } });
    const refused = await (await owner()).post("/api/billing/checkout", { planId: "professional", billingCycle: "MONTHLY" });
    assert.equal(refused.status, 503);
    await save(billing, { value: { enabled: true } });
  });

  test("the connection test really calls Paystack and records successes and failures", async () => {
    const billing = await as(STAFF.billing);
    const ok = await billing.post("/api/platform/settings/payments.paystack/test");
    assert.deepEqual([ok.data.ok, ok.data.detail], [true, "Connected in test mode (keys from settings)."]);
    assert.match(paystack.state.requests.at(-1).url, /^\/transaction\?perPage=1/);
    await save(billing, { secrets: { testSecretKey: "sk_test_revokedkey0123456789abcdef" } });
    const failed = await billing.post("/api/platform/settings/payments.paystack/test");
    assert.equal(failed.data.ok, false);
    assert.match(failed.data.checks.lastError.detail, /Invalid key/);
    assert.ok(failed.data.checks.lastSuccessAt, "the last success is still shown");
    const dashboard = await (await page(billing, "/platform")).text();
    assert.match(dashboard, /data-health-item="Payment gateway \(Paystack\)" data-status="error"/, dashboard.match(/data-health-item="Payment gateway[^]{0,400}/)?.[0]);
    await save(billing, { secrets: { testSecretKey: TEST_SECRET } });
  });
});

describe("Dashboard figures are the database's", () => {
  test("pharmacy counts, revenue and payments match the records", async () => {
    const support = await as(STAFF.support);
    const html = (await (await page(support, "/platform")).text()).replaceAll("<!-- -->", "");
    const [{ customers }] = await server.query("SELECT count(*) AS customers FROM tenants WHERE NOT is_demo");
    const [{ active }] = await server.query("SELECT count(*) AS active FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.status = 'ACTIVE' AND (s.current_period_end IS NULL OR s.current_period_end > now()) AND t.status = 'ACTIVE'");
    const stat = (title) => html.match(new RegExp(`data-stat="${title}"[^>]*>.*?<p[^>]*>${title}</p><p[^>]*>([^<]+)</p>`))?.[1];
    assert.equal(stat("Pharmacies"), String(customers));
    assert.equal(stat("Active \\(paid\\)"), String(active), "demo (complimentary) plus Sunrise");
    assert.equal(stat("Monthly recurring revenue"), "₦30,000", "Sunrise's Professional plan; the demo is not revenue");
    assert.equal(stat("Annual recurring revenue"), "₦360,000");
    assert.equal(stat("Successful payments"), "1");
    assert.equal(stat("New registrations"), "1");
  });

  test("health shows real checks: the database now, jobs once they have run", async () => {
    const technical = await as(STAFF.technical);
    let html = await (await page(technical, "/platform")).text();
    assert.match(html, /data-health-item="Database" data-status="ok"/);
    assert.match(html, /data-health-item="Background jobs" data-status="unknown"/);
    assert.match(html, /data-health-item="Email service" data-status="unknown"/, "configured, but never tested: not shown as connected");
    const ran = await fetch(`${server.baseUrl}/api/alerts/jobs`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET }, body: JSON.stringify({ job: "scan" }) });
    assert.equal(ran.status, 200);
    html = await (await page(technical, "/platform")).text();
    assert.match(html, /data-health-item="Background jobs" data-status="ok"/);
    const [run] = await server.query("SELECT job, trigger, pharmacies, failed, finished_at FROM platform_job_runs ORDER BY started_at DESC LIMIT 1");
    assert.deepEqual([run.job, run.trigger, run.failed], ["alert-scan", "external", 0]);
    assert.ok(run.pharmacies >= 2 && run.finished_at);
  });
});
