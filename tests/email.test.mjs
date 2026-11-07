// SaaS phase 7B: platform email: Control Centre settings (ZeptoMail API, SMTP), encrypted credentials,
// connection checks, test emails, the delivery log and retry queue, and editable templates.
// Real providers are replaced by local fakes (tests/helpers/fake-mail.mjs): nothing leaves the machine.
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startFakeSmtp, startFakeZepto } from "./helpers/fake-mail.mjs";
import { startServer } from "./helpers/server.mjs";

const ZEPTO_TOKEN = "wSsVR60fakeZeptoTokenForTests0123456789ABCDEF==";
const WRONG_TOKEN = "wSsVR60wrongTokenNotAccepted9876543210zyxwv==";
const SMTP_USER = "mailer";
const SMTP_PASS = "smtp-Pass-for-tests-7f3k";
const CRON_SECRET = "cron-secret-for-email-tests";
const OWNER = "ngozi@sunrise.ng";
const PASSWORD = "Email-Settings-2026";
const STAFF = {
  super: { id: "p-super", email: "super@web365.ng", role: "PLATFORM_SUPER_ADMIN" },
  support: { id: "p-support", email: "support@web365.ng", role: "PLATFORM_SUPPORT" },
  billing: { id: "p-billing", email: "billing@web365.ng", role: "BILLING_ADMIN" },
  technical: { id: "p-tech", email: "tech@web365.ng", role: "TECHNICAL_ADMIN" },
};
const SECRETS = [ZEPTO_TOKEN, WRONG_TOKEN, SMTP_PASS];

let server;
let zepto;
let smtp;

before(async () => {
  zepto = await startFakeZepto(ZEPTO_TOKEN);
  smtp = await startFakeSmtp(SMTP_USER, SMTP_PASS);
  server = await startServer({ ZEPTOMAIL_BASE_URL: zepto.url, CRON_SECRET });
  for (const person of Object.values(STAFF)) {
    const salt = randomBytes(16).toString("hex");
    await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", person.id, person.email, person.role, person.role, `${salt}:${pbkdf2Sync(PASSWORD, salt, 310000, 32, "sha256").toString("hex")}`);
  }
  const response = await fetch(`${server.baseUrl}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(), businessName: "Sunrise Pharmacy", businessEmail: "hello@sunrise.ng", businessPhone: "0803 123 4567", ownerName: "Ngozi Okafor",
      ownerEmail: OWNER, ownerPhone: "0809 765 4321", address: "12 Allen Avenue, Ikeja", country: "NG", state: "Lagos", currency: "NGN",
      timeZone: "Africa/Lagos", password: "Sunrise2026", planId: "professional", billingCycle: "MONTHLY",
    }),
  });
  assert.equal(response.status, 201, await response.text());
});
after(async () => {
  await server?.stop();
  await zepto?.close();
  await smtp?.close();
});

async function as(person) {
  const client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/platform/login", { email: person.email, password: PASSWORD })).status, 200);
  return client;
}
const page = (client, path) => client.request("GET", path, undefined, { raw: true });
const save = (client, body) => client.request("PUT", "/api/platform/settings/email.delivery", body);
const ZEPTO = { enabled: true, provider: "zeptomail_api", zeptoRegion: "com", senderName: "Pharmacy ERP", senderEmail: "support@pharmerp.name.ng", replyTo: "help@pharmerp.name.ng" };
const deliveries = (where = "TRUE", ...params) => server.query(`SELECT * FROM email_deliveries WHERE ${where} ORDER BY created_at`, ...params);
const forgot = (email) => fetch(`${server.baseUrl}/api/auth/password/forgot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
function assertNoSecrets(texts) {
  for (const text of texts) for (const secret of SECRETS) assert.ok(!String(text ?? "").includes(secret) && !String(text ?? "").includes(secret.slice(6, 26)), "a credential leaked");
}

describe("Access", () => {
  test("only Super Admins and Technical Admins manage email", async () => {
    for (const [name, person] of Object.entries(STAFF)) {
      const client = await as(person);
      const allowed = name === "super" || name === "technical";
      assert.equal((await page(client, "/platform/settings/email")).status, allowed ? 200 : 307, `${name} page`);
      assert.equal((await page(client, "/platform/settings/email/templates")).status, allowed ? 200 : 307, `${name} templates page`);
      for (const [method, path, body] of [["GET", "/api/platform/settings/email.delivery"], ["GET", "/api/platform/email/deliveries"], ["GET", "/api/platform/email/templates"], ["POST", "/api/platform/email/test", { to: "x@example.com" }], ["POST", "/api/platform/settings/email.delivery/test"]]) {
        assert.equal((await client.request(method, path, body)).status, allowed ? 200 : 403, `${name} ${method} ${path}`);
      }
    }
  });

  test("pharmacy accounts reach none of it", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await admin.get("/api/platform/email/deliveries")).status, 401);
    assert.equal((await save(admin, { value: { enabled: false } })).status, 401);
    assert.equal((await admin.request("PUT", "/api/platform/email/templates/welcome", { subject: "x", body: "{{link}}" })).status, 401);
  });
});

describe("Delivery log", () => {
  test("registration emails are logged; message bodies are not kept for sent emails", async () => {
    const rows = await deliveries("recipient = ?", OWNER);
    assert.deepEqual(rows.map((row) => [row.category, row.template, row.status, row.provider]), [["account", "verify_email", "SENT", "json"], ["account", "trial_started", "SENT", "json"]]);
    assert.ok(rows.every((row) => row.body_ciphertext === null && row.attempts === 1));
  });
});

describe("ZeptoMail API", () => {
  test("settings are validated and the token is stored encrypted, masked, and never shown or logged", async () => {
    const admin = await as(STAFF.technical);
    assert.equal((await save(admin, { value: { enabled: true, senderEmail: "" } })).status, 422, "sender required");
    assert.equal((await save(admin, { value: { ...ZEPTO, provider: "smtp", host: "" } })).status, 422, "SMTP needs a host");
    assert.equal((await save(admin, { value: ZEPTO, secrets: { apiToken: "short" } })).status, 422, "token format");
    const saved = await save(admin, { value: ZEPTO, secrets: { apiToken: `Zoho-enczapikey ${WRONG_TOKEN}` } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.secrets.apiToken, { set: true, hint: `•••• ${WRONG_TOKEN.slice(-4)}` });
    const [row] = await server.query("SELECT value::text AS value, secret_ciphertext FROM platform_settings WHERE key = 'email.delivery'");
    assert.match(row.secret_ciphertext, /^v1:/);
    const history = await server.query("SELECT changes::text AS changes FROM platform_settings_history WHERE key = 'email.delivery'");
    assertNoSecrets([JSON.stringify(saved.data), JSON.stringify((await admin.get("/api/platform/settings/email.delivery")).data), await (await page(admin, "/platform/settings/email")).text(), row.value, row.secret_ciphertext, ...history.map((entry) => entry.changes)]);
  });

  test("the connection test is real: a wrong token fails, the right one passes, and no email is sent", async () => {
    const admin = await as(STAFF.technical);
    const wrong = await admin.post("/api/platform/settings/email.delivery/test");
    assert.equal(wrong.data.ok, false);
    assert.match(wrong.data.detail, /rejected the token/);
    await save(admin, { secrets: { apiToken: ZEPTO_TOKEN } });
    const right = await admin.post("/api/platform/settings/email.delivery/test");
    assert.equal(right.data.ok, true, right.data.detail);
    assert.equal(zepto.state.sent.length, 0, "the connection test sends nothing");
    assert.equal(zepto.state.requests.at(-1).authorization, `Zoho-enczapikey ${ZEPTO_TOKEN}`);
    const checks = await server.query("SELECT ok FROM integration_checks WHERE integration = 'email' ORDER BY checked_at");
    assert.deepEqual(checks.slice(-2).map((check) => check.ok), [false, true]);
    assertNoSecrets([JSON.stringify(wrong.data), JSON.stringify(right.data)]);
  });

  test("a test email goes through ZeptoMail with the sender, reply-to, text and HTML", async () => {
    const admin = await as(STAFF.super);
    const result = await admin.post("/api/platform/email/test", { to: "daniel@example.com" });
    assert.equal(result.data.status, "SENT", result.data.detail);
    const sent = zepto.state.sent.at(-1);
    assert.deepEqual(sent.from, { address: "support@pharmerp.name.ng", name: "Pharmacy ERP" });
    assert.deepEqual(sent.to, [{ email_address: { address: "daniel@example.com" } }]);
    assert.deepEqual(sent.reply_to, [{ address: "help@pharmerp.name.ng" }]);
    assert.match(sent.subject, /Test email/);
    assert.match(sent.textbody, /email delivery works/);
    assert.match(sent.htmlbody, /<html/i);
    const [row] = await deliveries("recipient = 'daniel@example.com'");
    assert.deepEqual([row.category, row.status, row.provider, row.provider_message_id], ["test", "SENT", "zeptomail_api", `zepto-${zepto.state.sent.length}`]);
  });

  test("a failed platform email waits encrypted, and is sent by the retry button or the scheduled queue", async () => {
    zepto.state.failNext = 1;
    assert.equal((await forgot(OWNER)).status, 200);
    let [row] = await deliveries("template = 'password_reset'");
    assert.equal(row.status, "RETRYING");
    assert.match(row.last_error, /ZeptoMail 500/);
    assert.match(row.body_ciphertext, /^v1:/);
    assert.ok(!row.body_ciphertext.includes("reset-password"), "the link is encrypted");
    assert.ok(new Date(row.next_attempt_at) > new Date(), "waits before retrying");

    const admin = await as(STAFF.super);
    const html = await (await page(admin, "/platform/settings/email?status=RETRYING")).text();
    assert.match(html, /data-delivery="RETRYING"/);
    assert.ok(!html.includes("reset-password?token"), "the log never shows bodies");
    const retried = await admin.post(`/api/platform/email/deliveries/${row.id}/retry`);
    assert.equal(retried.data.status, "SENT", retried.data.detail);
    [row] = await deliveries("id = ?", row.id);
    assert.deepEqual([row.status, row.attempts, row.body_ciphertext, row.next_attempt_at], ["SENT", 2, null, null]);
    assert.match(zepto.state.sent.at(-1).textbody, /\/reset-password\?token=/);

    zepto.state.failNext = 1;
    await forgot(OWNER);
    [row] = (await deliveries("template = 'password_reset' AND status = 'RETRYING'"));
    await server.query("UPDATE email_deliveries SET next_attempt_at = now() - interval '1 minute' WHERE id = ?", row.id);
    const cron = await fetch(`${server.baseUrl}/api/alerts/jobs`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    assert.deepEqual((await cron.json()).emailQueue, { due: 1, sent: 1 });
    [row] = await deliveries("id = ?", row.id);
    assert.equal(row.status, "SENT");
    const [run] = await server.query("SELECT detail FROM platform_job_runs WHERE job = 'email-queue' ORDER BY started_at DESC LIMIT 1");
    assert.equal(run.detail, "1 due, 1 sent");
  });

  test("the application cannot delete or truncate the delivery log", async () => {
    for (const statement of ["DELETE FROM email_deliveries", "TRUNCATE email_deliveries"]) {
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

describe("Templates", () => {
  test("edits are checked for unknown and required variables", async () => {
    const admin = await as(STAFF.super);
    const unknown = await admin.request("PUT", "/api/platform/email/templates/password_reset", { subject: "Reset {{nickname}}", body: "Go to {{link}}" });
    assert.equal(unknown.status, 422);
    assert.match(unknown.data.error, /\{\{nickname\}\}/);
    const missing = await admin.request("PUT", "/api/platform/email/templates/password_reset", { subject: "Reset", body: "Contact us." });
    assert.equal(missing.status, 422);
    assert.match(missing.data.error, /\{\{link\}\}/);
    assert.equal((await admin.request("PUT", "/api/platform/email/templates/no_such_email", { subject: "x", body: "y" })).status, 404);
  });

  test("a saved template is used for the next email, with HTML escaped, and can be reset", async () => {
    const admin = await as(STAFF.super);
    const body = "Hello {{name}},\n\n<script>alert(1)</script> {{message}}\n\nMore at https://pharmerp.name.ng/help";
    const preview = await admin.post("/api/platform/email/templates/system_announcement/preview", { subject: "Notice: {{title}}", body });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.match(preview.data.html, /&lt;script&gt;/);
    assert.equal((await server.query("SELECT count(*)::int AS n FROM email_templates"))[0].n, 0, "a preview saves nothing");

    const saved = await admin.request("PUT", "/api/platform/email/templates/system_announcement", { subject: "Notice: {{title}}", body });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.template.customised, true);
    await admin.post("/api/platform/email/test", { to: "templates@example.com" });
    const sent = zepto.state.sent.at(-1);
    assert.equal(sent.subject, "Notice: Test email from Pharmacy ERP");
    assert.ok(!sent.htmlbody.includes("<script>"), "HTML from a template is escaped");
    assert.match(sent.htmlbody, /&lt;script&gt;/);
    assert.match(sent.htmlbody, /<a href="https:\/\/pharmerp\.name\.ng\/help"/);
    assert.match(sent.textbody, /<script>alert\(1\)<\/script>/, "the text version is unchanged");

    const detail = await admin.get("/api/platform/email/templates/system_announcement");
    assert.match(detail.data.history[0].changes.join(" "), /subject/);
    const reset = await admin.request("DELETE", "/api/platform/email/templates/system_announcement");
    assert.equal(reset.data.template.customised, false);
    const audit = await server.query("SELECT action FROM platform_audit_events WHERE action LIKE 'email.template%' ORDER BY at");
    assert.deepEqual(audit.map((entry) => entry.action), ["email.template-update", "email.template-reset"]);
  });
});

describe("SMTP", () => {
  const SMTP = { enabled: true, provider: "smtp", host: "127.0.0.1", encryption: "none", username: SMTP_USER };

  test("the connection test logs in for real; a wrong password fails without showing it", async () => {
    const admin = await as(STAFF.technical);
    assert.equal((await save(admin, { value: { ...SMTP, port: smtp.port }, secrets: { password: "not-the-password" } })).status, 200);
    const wrong = await admin.post("/api/platform/settings/email.delivery/test");
    assert.equal(wrong.data.ok, false);
    assertNoSecrets([wrong.data.detail]);
    assert.ok(!wrong.data.detail.includes("not-the-password"));
    await save(admin, { secrets: { password: SMTP_PASS } });
    const right = await admin.post("/api/platform/settings/email.delivery/test");
    assert.equal(right.data.ok, true, right.data.detail);
    assert.equal(smtp.state.messages.length, 0, "the connection test sends nothing");
  });

  test("emails go out through the SMTP server from the configured sender", async () => {
    const admin = await as(STAFF.super);
    const result = await admin.post("/api/platform/email/test", { to: "smtp-check@example.com" });
    assert.equal(result.data.status, "SENT", result.data.detail);
    const [message] = smtp.state.messages;
    assert.match(message.from, /support@pharmerp\.name\.ng/);
    assert.match(message.to[0], /smtp-check@example\.com/);
    assert.match(message.raw, /Subject: Test email from Pharmacy ERP/);
    assert.match(message.raw, /Reply-To: help@pharmerp\.name\.ng/);
  });

  test("turning email off stops sending, and says so", async () => {
    const admin = await as(STAFF.super);
    await save(admin, { value: { enabled: false } });
    const result = await admin.post("/api/platform/email/test", { to: "off@example.com" });
    assert.equal(result.data.status, "SKIPPED");
    assert.match(result.data.detail, /turned off/);
    assert.equal(smtp.state.messages.length, 1);
    const [row] = await deliveries("recipient = 'off@example.com'");
    assert.deepEqual([row.status, row.attempts], ["SKIPPED", 0]);
  });
});

describe("Secrets", () => {
  test("no credential appears in the audit log, the delivery log, history or server logs", async () => {
    const audit = await server.query("SELECT summary FROM platform_audit_events");
    const log = await server.query("SELECT coalesce(last_error, '') || ' ' || coalesce(provider_message_id, '') AS text FROM email_deliveries");
    const checks = await server.query("SELECT detail FROM integration_checks");
    const history = await server.query("SELECT changes::text AS changes FROM platform_settings_history");
    assertNoSecrets([...audit.map((row) => row.summary), ...log.map((row) => row.text), ...checks.map((row) => row.detail), ...history.map((row) => row.changes), server.logs()]);
  });
});
