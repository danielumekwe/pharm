// SaaS phase 6: subscription payments through Paystack (a local stand-in), invoices and webhooks.
import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const SECRET = "sk_test_fake_paystack_secret";

// ------------------------------------------------------------------ Paystack stand-in
const paystack = { transactions: new Map(), initialized: [], verifyCalls: 0 };
const fake = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const send = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (request.headers.authorization !== `Bearer ${SECRET}`) return send(401, { status: false, message: "Invalid key" });
    if (request.method === "POST" && request.url === "/transaction/initialize") {
      const input = JSON.parse(body);
      paystack.initialized.push(input);
      paystack.transactions.set(input.reference, { ...input, status: "ongoing", id: paystack.transactions.size + 1000 });
      return send(200, { status: true, data: { authorization_url: `${fakeUrl}/checkout/${input.reference}`, access_code: "AC", reference: input.reference } });
    }
    const match = request.url.match(/^\/transaction\/verify\/(.+)$/);
    if (request.method === "GET" && match) {
      paystack.verifyCalls += 1;
      const transaction = paystack.transactions.get(decodeURIComponent(match[1]));
      if (!transaction) return send(404, { status: false, message: "Transaction reference not found" });
      return send(200, {
        status: true,
        data: {
          id: transaction.id, status: transaction.status, reference: transaction.reference, amount: transaction.paidAmount ?? transaction.amount, currency: transaction.paidCurrency ?? transaction.currency,
          channel: "card", paid_at: new Date().toISOString(), gateway_response: transaction.status === "success" ? "Successful" : "Declined",
          customer: { customer_code: "CUS_sunrise" },
          authorization: { authorization_code: "AUTH_sunrise", card_type: "visa ", last4: "4081", exp_month: "12", exp_year: "2030", bank: "TEST BANK", reusable: true },
        },
      });
    }
    send(404, { status: false, message: "Not found" });
  });
});
let fakeUrl;
const setOutcome = (reference, status, extra = {}) => Object.assign(paystack.transactions.get(reference), { status, ...extra });

let server;
let sunrise;
const OWNER = { email: "ngozi@sunrise.ng", password: "Sunrise2026" };

before(async () => {
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  server = await startServer({ PAYSTACK_SECRET_KEY: SECRET, PAYSTACK_BASE_URL: fakeUrl });
  await server.query("UPDATE plans SET monthly_price = 15000, annual_price = 150000 WHERE id = 'starter'");
  await server.query("UPDATE plans SET monthly_price = 30000, annual_price = 300000 WHERE id = 'professional'");
  await server.query("UPDATE plans SET monthly_price = 75000, annual_price = NULL, max_outlets = 20, max_staff_accounts = 100 WHERE id = 'enterprise'");
  const response = await fetch(`${server.baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(), businessName: "Sunrise Pharmacy", businessEmail: "hello@sunrise.ng", businessPhone: "0803 123 4567", ownerName: "Ngozi Okafor",
      ownerEmail: OWNER.email, ownerPhone: "0809 765 4321", address: "12 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN",
      timeZone: "Africa/Lagos", password: OWNER.password, planId: "professional", billingCycle: "MONTHLY",
    }),
  });
  sunrise = await response.json();
  assert.equal(response.status, 201, JSON.stringify(sunrise));
});
after(async () => {
  await server?.stop();
  fake.close();
});

async function owner() {
  const client = new Client(server.baseUrl);
  assert.equal(await client.login(OWNER.email, "HQ", OWNER.password), null);
  return client;
}
const subscription = async () => (await server.query("SELECT plan_id, status, billing_cycle, trial_ends_at, current_period_end, cancel_at_period_end, scheduled_plan_id, card_label, authorization_code FROM subscriptions WHERE tenant_id = ?", sunrise.tenantId))[0];
const payment = async (reference) => (await server.query("SELECT status, amount, credit, purpose, failure_reason, settled_by FROM billing_payments WHERE reference = ?", reference))[0];
const invoices = async () => server.query("SELECT id, number, total, credit, period_start, period_end FROM invoices WHERE tenant_id = ? ORDER BY issued_at", sunrise.tenantId);
const sign = (body) => createHmac("sha512", SECRET).update(body).digest("hex");
async function webhook(event, { signature } = {}) {
  const body = JSON.stringify(event);
  const response = await fetch(`${server.baseUrl}/api/billing/webhooks/paystack`, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": signature ?? sign(body) }, body });
  return { status: response.status, data: await response.json() };
}
const chargeSuccess = (reference, id = randomUUID()) => ({ event: "charge.success", data: { id, reference, status: "success", amount: 1, currency: "NGN" } });
async function checkout(client, planId, billingCycle, extra = {}) {
  return client.post("/api/billing/checkout", { planId, billingCycle, ...extra });
}
const callback = (client, reference, query = "") => client.request("GET", `/billing/callback?reference=${reference}${query}`, undefined, { raw: true });

describe("Starting a payment", () => {
  test("only the Pharmacy Super Admin pays, the demo is never billed, and unpriced plans cannot be bought", async () => {
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    assert.equal((await checkout(manager, "starter", "MONTHLY")).status, 403);
    const demo = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await checkout(demo, "starter", "MONTHLY")).status, 409);
    const client = await owner();
    const unpriced = await checkout(client, "enterprise", "ANNUAL");
    assert.equal(unpriced.status, 409);
    assert.match(unpriced.data.error, /no annual price/);
    assert.equal(paystack.initialized.length, 0, "Paystack was never called");
  });

  test("the amount comes from the plan on the server; anything sent by the browser is ignored", async () => {
    const client = await owner();
    const started = await checkout(client, "professional", "MONTHLY", { amount: 1, currency: "USD", tenantId: "tenant-demo" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.match(started.data.checkoutUrl, new RegExp(`^${fakeUrl}/checkout/`));
    const sent = paystack.initialized.at(-1);
    assert.deepEqual([sent.amount, sent.currency, sent.email, sent.metadata.tenantId], [3_000_000, "NGN", OWNER.email, sunrise.tenantId]);
    assert.match(sent.callback_url, /\/billing\/callback$/);
    assert.deepEqual(await payment(started.data.reference), { status: "PENDING", amount: 30000, credit: 0, purpose: "START", failure_reason: null, settled_by: null });
  });
});

describe("Nothing is activated without Paystack's confirmation", () => {
  let reference;
  before(async () => {
    reference = (await checkout(await owner(), "professional", "MONTHLY")).data.reference;
  });

  test("a redirect claiming success changes nothing while Paystack says the payment is unfinished", async () => {
    const client = await owner();
    const page = await callback(client, reference, "&status=success&trxref=fake");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /not finished yet/);
    assert.equal((await payment(reference)).status, "PENDING");
    assert.equal((await subscription()).status, "TRIAL");
  });

  test("a webhook with a wrong signature is rejected; a pending one is retried until Paystack confirms", async () => {
    const event = chargeSuccess(reference, "evt-pending-1");
    assert.equal((await webhook(event, { signature: "f".repeat(128) })).status, 401);
    assert.equal((await webhook(event, { signature: "not-hex" })).status, 401);
    assert.equal((await webhook(event)).status, 500, "not confirmed yet: Paystack should retry");
    assert.equal((await subscription()).status, "TRIAL");
    setOutcome(reference, "abandoned");
    assert.equal((await webhook(event)).status, 200, "the retry is processed");
    assert.equal((await payment(reference)).status, "ABANDONED");
    assert.equal((await subscription()).status, "TRIAL");
  });

  test("a payment for the wrong amount or currency is refused and Web365 is alerted", async () => {
    const short = (await checkout(await owner(), "professional", "MONTHLY")).data.reference;
    setOutcome(short, "success", { paidAmount: 100_000 });
    const result = await webhook(chargeSuccess(short));
    assert.equal(result.data.result, "rejected");
    assert.equal((await payment(short)).status, "FAILED");
    assert.match((await payment(short)).failure_reason, /mismatch/);
    const dollars = (await checkout(await owner(), "professional", "MONTHLY")).data.reference;
    setOutcome(dollars, "success", { paidCurrency: "USD" });
    await callback(await owner(), dollars);
    assert.equal((await payment(dollars)).status, "FAILED");
    assert.equal((await subscription()).status, "TRIAL");
    const [alert] = await server.query("SELECT severity FROM platform_audit_events WHERE action = 'billing.payment-rejected' LIMIT 1");
    assert.equal(alert.severity, "critical");
  });

  test("a failed card is recorded with the reason and nothing else changes", async () => {
    const declined = (await checkout(await owner(), "professional", "MONTHLY")).data.reference;
    setOutcome(declined, "failed");
    await callback(await owner(), declined);
    assert.deepEqual([(await payment(declined)).status, (await payment(declined)).failure_reason], ["FAILED", "Declined"]);
    assert.equal((await subscription()).status, "TRIAL");
  });
});

describe("A confirmed payment", () => {
  let reference;
  let trialEnd;

  test("activates the plan from the end of the trial, saves the card and issues an invoice", async () => {
    trialEnd = new Date((await subscription()).trial_ends_at);
    reference = (await checkout(await owner(), "professional", "MONTHLY")).data.reference;
    setOutcome(reference, "success");
    const result = await webhook(chargeSuccess(reference, "evt-paid-1"));
    assert.deepEqual([result.status, result.data.result], [200, "activated"]);
    const after = await subscription();
    assert.deepEqual([after.status, after.plan_id, after.billing_cycle, after.card_label, after.authorization_code], ["ACTIVE", "professional", "MONTHLY", "visa •••• 4081 exp 12/2030", "AUTH_sunrise"]);
    const months = (new Date(after.current_period_end) - trialEnd) / 86_400_000;
    assert.ok(months >= 28 && months <= 31, `one month after the trial ends (${months} days)`);
    const [invoice] = await invoices();
    assert.match(invoice.number, new RegExp(`^W365-${new Date().getUTCFullYear()}-0000\\d\\d$`));
    assert.equal(invoice.total, 30000);
    const audit = (await server.query("SELECT action FROM audit_events WHERE tenant_id = ? AND action LIKE 'billing.%'", sunrise.tenantId)).map((row) => row.action);
    assert.ok(audit.includes("billing.checkout") && audit.includes("billing.payment-activated"));
  });

  test("is applied exactly once, however often it is reported", async () => {
    const before = await subscription();
    const duplicate = await webhook(chargeSuccess(reference, "evt-paid-1"));
    assert.deepEqual(duplicate.data, { ok: true, duplicate: true });
    const second = await webhook(chargeSuccess(reference, "evt-paid-1-redelivered"));
    assert.equal(second.data.result, "already");
    const page = await callback(await owner(), reference);
    assert.equal(page.status, 307);
    assert.match(page.headers.get("location"), /\/subscription\?paid=1/);
    assert.equal((await invoices()).length, 1);
    assert.deepEqual(await subscription(), before);
  });

  test("simultaneous confirmations of one renewal extend the period once", async () => {
    const before = new Date((await subscription()).current_period_end);
    const renewal = (await checkout(await owner(), "professional", "MONTHLY")).data;
    assert.equal(renewal.quote.purpose, "RENEWAL");
    setOutcome(renewal.reference, "success");
    const client = await owner();
    await Promise.all([webhook(chargeSuccess(renewal.reference, "evt-r1")), webhook(chargeSuccess(renewal.reference, "evt-r2")), callback(client, renewal.reference)]);
    const all = await invoices();
    assert.equal(all.length, 2, "one invoice for the renewal");
    const days = (new Date((await subscription()).current_period_end) - before) / 86_400_000;
    assert.ok(days >= 28 && days <= 31, `extended by one month only (${days} days)`);
  });

  test("an upgrade charges the difference after credit for unused time and starts now", async () => {
    const client = await owner();
    const preview = await client.get("/api/billing/quote?planId=enterprise&billingCycle=MONTHLY");
    assert.equal(preview.data.purpose, "UPGRADE");
    assert.ok(preview.data.credit > 0 && preview.data.credit <= 30000, JSON.stringify(preview.data));
    assert.equal(preview.data.amount, Math.round((75000 - preview.data.credit) * 100) / 100);
    const upgrade = await checkout(client, "enterprise", "MONTHLY");
    setOutcome(upgrade.data.reference, "success");
    await callback(client, upgrade.data.reference);
    const after = await subscription();
    assert.equal(after.plan_id, "enterprise");
    const days = (new Date(after.current_period_end) - Date.now()) / 86_400_000;
    assert.ok(days >= 27 && days <= 31);
    const latest = (await invoices()).at(-1);
    assert.ok(latest.credit > 0);
  });

  test("a downgrade is scheduled for the end of the paid period, with no payment, and can be withdrawn", async () => {
    const client = await owner();
    const calls = paystack.initialized.length;
    const scheduled = await checkout(client, "starter", "MONTHLY");
    assert.equal(scheduled.data.scheduled, true);
    assert.equal(paystack.initialized.length, calls, "no payment taken");
    assert.equal((await subscription()).scheduled_plan_id, "starter");
    assert.equal((await client.post("/api/billing/subscription", { action: "clear-scheduled-change" })).status, 200);
    assert.equal((await subscription()).scheduled_plan_id, null);
  });

  test("cancelling keeps access to the end of the period; after that only billing is reachable, and renewing works", async () => {
    const client = await owner();
    assert.equal((await client.post("/api/billing/subscription", { action: "cancel" })).status, 200);
    assert.equal((await subscription()).cancel_at_period_end, true);
    assert.equal((await client.get("/api/products")).status, 200, "still active until the period ends");
    await server.query("UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE tenant_id = ?", sunrise.tenantId);
    assert.equal((await client.get("/api/products")).status, 402);
    const page = await client.request("GET", "/products", undefined, { raw: true });
    assert.match(page.headers.get("location") ?? "", /\/subscription/);
    const billingPage = await (await client.request("GET", "/subscription", undefined, { raw: true })).text();
    assert.match(billingPage, /cancelled and has ended/);
    const back = await checkout(client, "professional", "MONTHLY");
    assert.equal(back.status, 200, "a lapsed pharmacy can still pay");
    setOutcome(back.data.reference, "success");
    await callback(client, back.data.reference);
    assert.deepEqual([(await subscription()).status, (await subscription()).cancel_at_period_end], ["ACTIVE", false]);
    assert.equal((await client.get("/api/products")).status, 200);
  });
});

describe("Invoices and records", () => {
  test("a pharmacy downloads only its own invoices; Web365 can download any", async () => {
    const [invoice] = await invoices();
    const own = await (await owner()).request("GET", `/api/billing/invoices/${invoice.id}`, undefined, { raw: true });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("content-type"), "application/pdf");
    assert.equal((await Buffer.from(await own.arrayBuffer())).subarray(0, 4).toString(), "%PDF");
    const other = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await other.request("GET", `/api/billing/invoices/${invoice.id}`, undefined, { raw: true })).status, 404);
    const salt = randomBytes(16).toString("hex");
    await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES ('puser-ops', 'ops@web365.ng', 'Ops', 'PLATFORM_SUPER_ADMIN', ?)", `${salt}:${pbkdf2Sync("Platform-Ops-2026", salt, 310000, 32, "sha256").toString("hex")}`);
    const ops = new Client(server.baseUrl);
    assert.equal((await ops.post("/api/platform/login", { email: "ops@web365.ng", password: "Platform-Ops-2026" })).status, 200);
    assert.equal((await ops.request("GET", `/api/platform/invoices/${invoice.id}`, undefined, { raw: true })).headers.get("content-type"), "application/pdf");
    const detail = await (await ops.request("GET", `/platform/tenants/${sunrise.tenantId}`, undefined, { raw: true })).text();
    assert.match(detail, new RegExp(invoice.number));
  });

  test("the payment page shows another pharmacy's payment to no one else", async () => {
    const [{ reference }] = await server.query("SELECT reference FROM billing_payments WHERE tenant_id = ? AND status = 'SUCCESS' LIMIT 1", sunrise.tenantId);
    const html = await (await callback(await signedIn(server.baseUrl, "admin@web365.ng"), reference)).text();
    assert.match(html, /If this payment was for your pharmacy/);
    assert.ok(!html.includes("Professional") && !html.includes("active until"));
  });

  test("an unknown successful charge is logged for Web365 to check by hand", async () => {
    const result = await webhook(chargeSuccess("W365-NOT-OURS-123"));
    assert.equal(result.data.result, "unknown");
    const [alert] = await server.query("SELECT severity FROM platform_audit_events WHERE action = 'billing.unknown-payment'");
    assert.equal(alert.severity, "critical");
  });

  test("payments, invoices and webhook history cannot be deleted by the application", async () => {
    for (const table of ["invoices", "billing_payments", "webhook_events"]) {
      await server.query("BEGIN");
      try {
        await server.query("SET LOCAL ROLE pharm_app");
        await assert.rejects(server.query(`DELETE FROM ${table}`), (error) => error.code === "42501", table);
      } finally {
        await server.query("ROLLBACK");
      }
    }
  });
});
