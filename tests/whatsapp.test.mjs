// WhatsApp through Zoho CPaaS: settings and secrets, connection test, templates and approval, pharmacy
// recipients with consent and opt-out, tenant isolation, the queue (duplicates, retries, permanent failures),
// signed delivery webhooks and the message log. Zoho is a local fake: no real message is ever sent.
import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

const API_KEY = "PHAfakeZohoAgentKeyForTests0123456789==";
const WRONG_KEY = "PHAwrongZohoAgentKeyNotAccepted98765==";
const WEBHOOK_KEY = "webhook-auth-key-for-tests-0123456789";
const SENDER = "+2349011112222";
const PASSWORD = "WhatsApp-Tests-2026";
const SECRETS = [API_KEY, WEBHOOK_KEY];

// ---------------------------------------------------------------- fake Zoho CPaaS
const zoho = { sends: [], logsCalls: 0, failNext: 0 };
const fake = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const reply = (status, json) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(json));
    const error = (status, code, detail, message) => reply(status, { error: { code, message, details: [{ code: detail, message }] } });
    if (request.headers.authorization !== `Zoho-enczapikey ${API_KEY}`) return error(401, "TM_4001", "SERR_157", "Invalid API Token found");
    const url = new URL(request.url, "http://fake");
    if (request.method === "GET" && url.pathname === "/v1.1/whatsapp/logs") {
      zoho.logsCalls += 1;
      const ref = url.searchParams.get("client_reference");
      const entries = zoho.sends.filter((send) => !ref || send.body.client_reference === ref).map((send) => ({ message_id: send.messageId, request_id: send.messageId, client_reference: send.body.client_reference, agent_id: "agent-mailer", waba_id: "980442141316461", from: send.body.from, to: send.body.to, status: "sent" }));
      return reply(200, { metadata: { offset: 0, count: entries.length }, data: entries.slice(0, Number(url.searchParams.get("limit") ?? 10)), status: "success" });
    }
    if (request.method === "POST" && url.pathname === "/v1.1/whatsapp") {
      const json = JSON.parse(body || "{}");
      if (zoho.failNext > 0) {
        zoho.failNext -= 1;
        return error(503, "TM_5001", "SERR_500", "Service unavailable");
      }
      if (!json.to || !/^\+\d{8,15}$/.test(json.to)) return error(400, "TM_3301", "SERR_110", "Parameter less than min occurrance");
      if (json.template_key === "rejected-key") return error(401, "TM_4001", "WA_103", "Template is not valid");
      const messageId = randomUUID();
      zoho.sends.push({ body: json, headers: request.headers, messageId });
      return reply(200, { data: { code: "MSG_101", message: "Message queued", message_id: messageId, request_id: randomUUID() }, status: "success" });
    }
    return error(404, "TM_3601", "SERR_120", "This URL does not exist");
  });
});

let server;
let admin;
let sunrise;
let moonlight;
const owners = {};

async function register(name, email) {
  const response = await fetch(`${server.baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(), businessName: name, businessEmail: `hello@${name.split(" ")[0].toLowerCase()}.ng`, businessPhone: "0803 123 4567", ownerName: `${name} Owner`,
      ownerEmail: email, ownerPhone: "0809 765 4321", address: "12 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN",
      timeZone: "Africa/Lagos", password: PASSWORD, planId: "professional", billingCycle: "MONTHLY",
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  const client = new Client(server.baseUrl);
  assert.equal(await client.login(email, "HQ", PASSWORD, body.tenantId), null);
  return { tenantId: body.tenantId, client };
}

before(async () => {
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  server = await startServer({ ZOHO_CPAAS_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
  const salt = randomBytes(16).toString("hex");
  await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", "p-super", "super@web365.ng", "Super", "PLATFORM_SUPER_ADMIN", `${salt}:${pbkdf2Sync(PASSWORD, salt, 310000, 32, "sha256").toString("hex")}`);
  admin = new Client(server.baseUrl);
  assert.equal((await admin.post("/api/platform/login", { email: "super@web365.ng", password: PASSWORD })).status, 200);
  sunrise = await register("Sunrise Pharmacy", "owner@sunrise.ng");
  moonlight = await register("Moonlight Pharmacy", "owner@moonlight.ng");
  owners.sunrise = sunrise.client;
  owners.moonlight = moonlight.client;
});
after(async () => {
  await server?.stop();
  fake.close();
});

const settings = (body) => admin.request("PUT", "/api/platform/settings/whatsapp.zoho", body);
const messages = (where = "TRUE", ...params) => server.query(`SELECT * FROM whatsapp_messages WHERE ${where} ORDER BY created_at`, ...params);
const runQueue = () => admin.post("/api/platform/system/jobs", { job: "email-queue" });
async function waitFor(check, label) {
  for (let i = 0; i < 60; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`timed out waiting for ${label}`);
}
async function template(body) {
  const response = await admin.post("/api/platform/whatsapp/templates", { language: "en", category: "UTILITY", active: true, ...body });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}
function signed(payload, key = WEBHOOK_KEY, ts = Date.now()) {
  const signature = createHmac("sha256", Buffer.from(key, "utf8")).update(payload, "utf8").digest("base64");
  return { header: `ts=${ts};s=${encodeURIComponent(signature)};s-algorithm=HmacSHA256`, body: `data=${encodeURIComponent(payload)}` };
}
const webhook = ({ header, body }) => fetch(`${server.baseUrl}/api/webhooks/zoho-cpaas`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(header ? { "producer-signature": header } : {}) }, body });
const event = (name, messageId, extra = {}) => JSON.stringify({
  event_name: [name], webhook_request_id: randomUUID(), mailagent_key: "agent",
  event_message: [{ whatsapp_info: { message_reference: messageId, client_reference: extra.clientReference ?? null, to: "+2348030000000", object: "whatsapp" }, event_data: { details: [{ status: name, time: new Date().toISOString(), ...(extra.reason ? { reason: extra.reason, error_code: "131026" } : {}) }], object: name }, request_id: "r" }],
});

describe("Control Centre connection", () => {
  test("credentials are encrypted, masked and never returned", async () => {
    assert.equal((await settings({ value: { baseUrl: "https://evil.example.com" } })).status, 422, "only Zoho CPaaS hosts");
    assert.equal((await settings({ value: { enabled: true } })).status, 422, "sender number needed before enabling");
    const saved = await settings({ value: { enabled: true, senderNumber: SENDER, defaultCountryCode: "234" }, secrets: { apiKey: WRONG_KEY, webhookKey: WEBHOOK_KEY } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const read = await admin.get("/api/platform/settings/whatsapp.zoho");
    assert.equal(read.data.secrets.apiKey.set, true);
    const page = await (await admin.request("GET", "/platform/settings/whatsapp", undefined, { raw: true })).text();
    for (const text of [JSON.stringify(saved.data), JSON.stringify(read.data), page]) for (const secret of SECRETS) assert.ok(!text.includes(secret), "a credential leaked");
    const [row] = await server.query("SELECT secret_ciphertext FROM platform_settings WHERE key = 'whatsapp.zoho'");
    assert.ok(!row.secret_ciphertext.includes(WRONG_KEY), "stored encrypted");
  });

  test("test connection reports invalid credentials, then succeeds without sending anything", async () => {
    const wrong = await admin.post("/api/platform/settings/whatsapp.zoho/test");
    assert.equal(wrong.data.ok, false);
    assert.match(wrong.data.detail, /rejected the API key/);
    assert.equal((await settings({ secrets: { apiKey: API_KEY } })).status, 200);
    const right = await admin.post("/api/platform/settings/whatsapp.zoho/test");
    assert.equal(right.data.ok, true, right.data.detail);
    assert.equal(zoho.sends.length, 0, "a connection test never sends a message");
    assert.ok(zoho.logsCalls >= 1, "checked with the read-only logs API");
    for (const secret of SECRETS) assert.ok(!JSON.stringify(right.data).includes(secret));
  });

  test("only platform staff with settings rights reach the WhatsApp pages and APIs", async () => {
    assert.equal((await owners.sunrise.get("/api/platform/whatsapp/templates")).status, 401);
    assert.equal((await new Client(server.baseUrl).post("/api/platform/whatsapp/test-message", {})).status, 401);
  });
});

describe("Templates", () => {
  test("variables must come from the notification type; key or alias, not both", async () => {
    assert.equal((await admin.post("/api/platform/whatsapp/templates", { name: "Bad", notificationType: "daily_report", templateKey: "k", status: "PENDING", variables: ["password"] })).status, 422);
    assert.equal((await admin.post("/api/platform/whatsapp/templates", { name: "Both", notificationType: "daily_report", templateKey: "k", templateAlias: "a", status: "PENDING", variables: [] })).status, 422);
  });

  test("an unapproved template is never sent; an approved one is, with the documented request", async () => {
    const pending = await template({ name: "Suspension notice", notificationType: "account_suspended", templateKey: "tpl-suspended", status: "PENDING", variables: ["pharmacy", "reason", "unsubscribe_link"] });
    const refused = await admin.post("/api/platform/whatsapp/test-message", { phone: "+2348030000001", templateId: pending.id, confirmed: true });
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, /not approved/);

    const approved = await admin.request("PUT", `/api/platform/whatsapp/templates/${pending.id}`, { name: "Suspension notice", notificationType: "account_suspended", templateKey: "tpl-suspended", status: "APPROVED", variables: ["pharmacy", "reason", "unsubscribe_link"], active: true });
    assert.equal(approved.status, 200);
    assert.equal((await admin.post("/api/platform/whatsapp/test-message", { phone: "+2348030000001", templateId: pending.id })).status, 422, "the admin must confirm the recipient agreed");
    assert.equal((await admin.post("/api/platform/whatsapp/test-message", { phone: "12", templateId: pending.id, confirmed: true })).status, 422, "invalid phone number");

    const sent = await admin.post("/api/platform/whatsapp/test-message", { phone: "0803 000 0001", templateId: pending.id, confirmed: true });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(sent.data.ok, true, sent.data.detail);
    const last = zoho.sends.at(-1);
    assert.equal(last.headers.authorization, `Zoho-enczapikey ${API_KEY}`);
    assert.equal(last.body.from, SENDER);
    assert.equal(last.body.to, "+2348030000001", "local number normalised with the default country code");
    assert.equal(last.body.template_key, "tpl-suspended");
    assert.deepEqual(Object.keys(last.body.merge_info).sort(), ["pharmacy", "reason", "unsubscribe_link"]);
    const [row] = await messages("category = 'test'");
    assert.equal(row.status, "SENT");
    assert.equal(row.provider_message_id, last.messageId);
    assert.equal(last.body.client_reference, row.id);
    assert.equal(row.values_ciphertext, null, "values are not kept once sent");
  });
});

describe("Pharmacy recipients and isolation", () => {
  let recipientId;
  test("a recipient needs recorded consent and a valid number", async () => {
    const base = { name: "Ngozi", phone: "0803 555 0101", types: ["account_suspended", "daily_report"] };
    assert.equal((await owners.sunrise.post("/api/whatsapp/recipients", base)).status, 422, "consent is required");
    assert.equal((await owners.sunrise.post("/api/whatsapp/recipients", { ...base, phone: "12", consent: true })).status, 422);
    const added = await owners.sunrise.post("/api/whatsapp/recipients", { ...base, consent: true, consentNote: "Signed form" });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    assert.equal(added.data.phone, "+2348035550101");
    assert.ok(added.data.consent_at);
    recipientId = added.data.id;
    assert.equal((await owners.sunrise.post("/api/whatsapp/recipients", { ...base, consent: true })).status, 409, "no duplicate numbers");
  });

  test("another pharmacy cannot see or change them", async () => {
    const other = await owners.moonlight.get("/api/whatsapp/settings");
    assert.equal(other.status, 200);
    assert.equal(other.data.recipients.length, 0);
    assert.equal((await owners.moonlight.patch(`/api/whatsapp/recipients/${recipientId}`, { optedOut: true })).status, 404);
    assert.equal((await owners.moonlight.delete(`/api/whatsapp/recipients/${recipientId}`)).status, 404);
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    assert.equal((await cashier.get("/api/whatsapp/settings")).status, 403, "only the Pharmacy Super Admin");
  });

  test("an account notice is queued once and sent in the background to consenting recipients", async () => {
    assert.equal((await admin.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "suspend", reason: "Unpaid invoice INV-1" })).status, 200);
    const row = await waitFor(async () => (await messages("tenant_id = ? AND category = 'account_suspended' AND status = 'SENT'", sunrise.tenantId))[0], "suspension message sent");
    assert.equal(row.recipient_phone, "+2348035550101");
    const send = zoho.sends.find((entry) => entry.body.client_reference === row.id);
    assert.equal(send.body.merge_info.reason, "Unpaid invoice INV-1");
    assert.equal(send.body.merge_info.pharmacy, "Sunrise Pharmacy");
    assert.match(send.body.merge_info.unsubscribe_link, /\/whatsapp\/unsubscribe\?t=/);
    assert.equal((await messages("tenant_id = ?", moonlight.tenantId)).length, 0, "nothing for the other pharmacy");

    const mine = await owners.moonlight.get(`/api/whatsapp/messages?tenant=${sunrise.tenantId}`);
    assert.equal(mine.data.messages.length, 0, "a pharmacy never sees another's messages");
    assert.equal((await admin.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "reactivate" })).status, 200);
  });

  test("a recipient who opts out by link receives nothing more", async () => {
    const [row] = await messages("tenant_id = ? AND category = 'account_suspended'", sunrise.tenantId);
    const link = zoho.sends.find((entry) => entry.body.client_reference === row.id).body.merge_info.unsubscribe_link;
    const token = new URL(link).searchParams.get("t");
    assert.equal((await fetch(`${server.baseUrl}/api/whatsapp/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: `${token.split(".")[0]}.forged` }) })).status, 400);
    const ok = await fetch(`${server.baseUrl}/api/whatsapp/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token }) });
    assert.equal(ok.status, 200);
    const before = zoho.sends.length;
    assert.equal((await admin.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "suspend", reason: "Second notice after opt-out" })).status, 200);
    await runQueue();
    assert.equal(zoho.sends.length, before, "opted-out recipient gets nothing");
    assert.equal((await admin.patch(`/api/platform/tenants/${sunrise.tenantId}`, { action: "reactivate" })).status, 200);
    assert.equal((await owners.sunrise.patch(`/api/whatsapp/recipients/${recipientId}`, { optedOut: false })).status, 422, "opting back in needs fresh consent");
    assert.equal((await owners.sunrise.patch(`/api/whatsapp/recipients/${recipientId}`, { optedOut: false, consent: true })).status, 200);
  });
});

describe("Daily report", () => {
  test("WhatsApp-only daily report: queued once per day, with the summary and a report link", async () => {
    const tpl = await template({ name: "Daily report", notificationType: "daily_report", templateAlias: "daily_report_v1", status: "APPROVED", variables: ["pharmacy", "date", "total_sales", "transactions", "report_link"] });
    assert.ok(tpl.id);
    const demo = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await demo.patch("/api/whatsapp/settings", { dailyReportChannel: "whatsapp" })).status, 200);
    assert.equal((await demo.post("/api/whatsapp/recipients", { name: "Demo owner", phone: "+2348036660000", types: ["daily_report"], consent: true })).status, 201);
    const dailyEmails = async () => (await server.query("SELECT count(*)::int AS n FROM notification_deliveries WHERE tenant_id = 'tenant-demo' AND channel = 'EMAIL' AND event LIKE 'daily-summary:%'"))[0].n;
    const emailsBefore = await dailyEmails();
    assert.equal((await demo.post("/api/alerts/jobs", { job: "daily" })).status, 200);
    const row = await waitFor(async () => (await messages("tenant_id = 'tenant-demo' AND category = 'daily_report' AND status = 'SENT'"))[0], "daily report sent");
    const send = zoho.sends.find((entry) => entry.body.client_reference === row.id);
    assert.equal(send.body.template_alias, "daily_report_v1");
    assert.equal(send.body.template_key, undefined);
    assert.match(send.body.merge_info.total_sales, /^₦/);
    assert.match(send.body.merge_info.report_link, /\/reports\/daily\?date=\d{4}-\d{2}-\d{2}$/);
    assert.equal(await dailyEmails(), emailsBefore, "WhatsApp only: no daily summary email");

    // The same day again: no second message.
    assert.equal((await demo.post("/api/alerts/jobs", { job: "daily" })).status, 200);
    await runQueue();
    assert.equal((await messages("tenant_id = 'tenant-demo' AND category = 'daily_report'")).length, 1, "never twice");

    const page = await demo.request("GET", `/reports/daily?date=${send.body.merge_info.date}`, undefined, { raw: true });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /data-daily-report/);
    assert.equal((await new Client(server.baseUrl).request("GET", "/reports/daily", undefined, { raw: true })).status, 307, "the full report needs sign-in");
  });
});

describe("Queue reliability", () => {
  test("temporary failures are retried; permanent ones and rejected templates are not", async () => {
    const tpl = await template({ name: "Reactivation", notificationType: "account_reactivated", templateKey: "tpl-reactivated", status: "APPROVED", variables: ["pharmacy", "link"] });
    zoho.failNext = 1;
    assert.equal((await owners.moonlight.post("/api/whatsapp/recipients", { name: "Moon", phone: "+2348037770000", types: ["account_reactivated"], consent: true })).status, 201);
    assert.equal((await admin.patch(`/api/platform/tenants/${moonlight.tenantId}`, { action: "suspend", reason: "Check" })).status, 200);
    assert.equal((await admin.patch(`/api/platform/tenants/${moonlight.tenantId}`, { action: "reactivate" })).status, 200);
    const retrying = await waitFor(async () => (await messages("tenant_id = ? AND category = 'account_reactivated' AND attempts = 1 AND status = 'QUEUED'", moonlight.tenantId))[0], "first attempt failed");
    assert.match(retrying.failure_reason, /503/);
    await server.query("UPDATE whatsapp_messages SET next_attempt_at = now() WHERE id = ?", retrying.id);
    await runQueue();
    const [sent] = await messages("id = ?", retrying.id);
    assert.equal(sent.status, "SENT");
    assert.equal(sent.attempts, 2);

    // Zoho refuses the template: failed at once, template marked rejected, nothing retried.
    await admin.request("PUT", `/api/platform/whatsapp/templates/${tpl.id}`, { name: "Reactivation", notificationType: "account_reactivated", templateKey: "rejected-key", status: "APPROVED", variables: ["pharmacy", "link"], active: true });
    await server.query("DELETE FROM whatsapp_messages WHERE id = ?", retrying.id);
    assert.equal((await admin.patch(`/api/platform/tenants/${moonlight.tenantId}`, { action: "suspend", reason: "Check again" })).status, 200);
    assert.equal((await admin.patch(`/api/platform/tenants/${moonlight.tenantId}`, { action: "reactivate" })).status, 200);
    const failed = await waitFor(async () => (await messages("tenant_id = ? AND category = 'account_reactivated' AND status = 'FAILED'", moonlight.tenantId))[0], "permanent failure");
    assert.match(failed.failure_reason, /WA_103/);
    assert.equal(failed.attempts, 1);
    const [rejected] = await server.query("SELECT status FROM whatsapp_templates WHERE id = ?", tpl.id);
    assert.equal(rejected.status, "REJECTED");

    // A missing template variable fails the message without calling Zoho.
    await admin.request("PUT", `/api/platform/whatsapp/templates/${tpl.id}`, { name: "Reactivation", notificationType: "account_reactivated", templateKey: "tpl-reactivated", status: "APPROVED", variables: ["pharmacy", "link"], active: true });
    await server.query("UPDATE whatsapp_messages SET status = 'QUEUED', values_ciphertext = NULL, attempts = 0, next_attempt_at = now() WHERE id = ?", failed.id);
    const before = zoho.sends.length;
    await runQueue();
    const [missing] = await messages("id = ?", failed.id);
    assert.equal(missing.status, "FAILED");
    assert.match(missing.failure_reason, /Missing template variable/);
    assert.equal(zoho.sends.length, before);
  });

  test("with no approved template, the notice is recorded as not sent, with the reason", async () => {
    const response = await owners.moonlight.patch(`/api/whatsapp/recipients/${(await owners.moonlight.get("/api/whatsapp/settings")).data.recipients[0].id}`, { types: ["account_reactivated", "announcement"] });
    assert.equal(response.status, 200);
    const announcement = await admin.post("/api/platform/announcements", { title: "Maintenance tonight", body: "The system will be down 1-2am.", severity: "warning", audience: { type: "all" }, startsAt: null, endsAt: null, emailOwners: true });
    assert.equal(announcement.status, 201, JSON.stringify(announcement.data));
    assert.equal((await admin.post(`/api/platform/announcements/${announcement.data.id}`, { action: "publish" })).status, 200);
    const skipped = await waitFor(async () => (await messages("tenant_id = ? AND category = 'announcement'", moonlight.tenantId))[0], "announcement recorded");
    assert.equal(skipped.status, "SKIPPED");
    assert.match(skipped.failure_reason, /No WhatsApp template is set up/);
  });
});

describe("Delivery webhooks", () => {
  test("only correctly signed, recent events are accepted; status moves forward once", async () => {
    const [row] = await messages("category = 'test'");
    assert.equal((await webhook({ body: "" })).status, 200, "Zoho's empty verify request");
    assert.equal((await webhook({ body: `data=${encodeURIComponent(event("whatsapp_delivered", row.provider_message_id))}` })).status, 401, "no signature");
    assert.equal((await webhook(signed(event("whatsapp_delivered", row.provider_message_id), "wrong-key-wrong-key-wrong"))).status, 401, "wrong key");
    assert.equal((await webhook(signed(event("whatsapp_delivered", row.provider_message_id), WEBHOOK_KEY, Date.now() - 3_600_000))).status, 401, "too old");
    const [unchanged] = await messages("id = ?", row.id);
    assert.equal(unchanged.status, "SENT");

    const delivered = signed(event("whatsapp_delivered", row.provider_message_id));
    assert.equal((await webhook(delivered)).status, 200);
    assert.equal((await messages("id = ?", row.id))[0].status, "DELIVERED");
    const again = await (await webhook(delivered)).json();
    assert.deepEqual(again.results, ["duplicate"]);

    assert.equal((await webhook(signed(event("whatsapp_read", row.provider_message_id)))).status, 200);
    const [read] = await messages("id = ?", row.id);
    assert.equal(read.status, "READ");
    assert.ok(read.read_at && read.delivered_at);
    await webhook(signed(event("whatsapp_undelivered", row.provider_message_id, { reason: "late" })));
    assert.equal((await messages("id = ?", row.id))[0].status, "READ", "undelivered never overrides a confirmed delivery");

    const unknown = await (await webhook(signed(event("whatsapp_delivered", "not-ours")))).json();
    assert.deepEqual(unknown.results, ["unknown message"]);
  });

  test("an undelivered message records Zoho's reason", async () => {
    const [row] = await messages("category = 'account_suspended' AND status = 'SENT'");
    await webhook(signed(event("whatsapp_undelivered", null, { clientReference: row.id, reason: "Not a WhatsApp number" })));
    const [after] = await messages("id = ?", row.id);
    assert.equal(after.status, "UNDELIVERED");
    assert.match(after.failure_reason, /Not a WhatsApp number/);
  });
});

describe("Message log", () => {
  test("Control Centre filters by pharmacy, status and type; pharmacy sees only its own", async () => {
    const all = await admin.get(`/api/platform/whatsapp/messages?tenant=${sunrise.tenantId}`);
    assert.ok(all.data.messages.length > 0);
    assert.ok(all.data.messages.every((row) => row.tenant_id === sunrise.tenantId));
    const failed = await admin.get("/api/platform/whatsapp/messages?status=FAILED&category=account_reactivated");
    assert.equal(failed.status, 200, JSON.stringify(failed.data));
    assert.ok(failed.data.messages.every((row) => row.status === "FAILED" && row.category === "account_reactivated"));
    const own = await owners.sunrise.get("/api/whatsapp/messages");
    assert.ok(own.data.messages.every((row) => row.tenant_id === sunrise.tenantId));
    const page = await (await admin.request("GET", "/platform/whatsapp?status=SENT", undefined, { raw: true })).text();
    assert.match(page, /data-whatsapp-log/);
    for (const secret of SECRETS) assert.ok(!page.includes(secret));
  });
});
