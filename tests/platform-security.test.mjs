// SaaS phase 7D: platform security: server-side sessions (list, revoke, idle and expiry), sign-in log and
// lockout, two-factor sign-in with recovery codes, the security policy (required two-factor, IP allowlist),
// forced password change for temporary passwords, and logging of pharmacy sign-ins.
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { Client } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";
import { totp } from "./helpers/totp.mjs";

const PASSWORD = "Platform-Security-2026";
const STAFF = {
  super: { id: "p-super", email: "super@web365.ng", role: "PLATFORM_SUPER_ADMIN" },
  support: { id: "p-support", email: "support@web365.ng", role: "PLATFORM_SUPPORT" },
  billing: { id: "p-billing", email: "billing@web365.ng", role: "BILLING_ADMIN" },
  locked: { id: "p-locked", email: "locked@web365.ng", role: "PLATFORM_SUPPORT" },
};

let server;
/** The Super Admin's recovery codes (set in the two-factor tests, used to sign in later). */
let superCodes = [];

before(async () => {
  server = await startServer();
  for (const person of Object.values(STAFF)) {
    const salt = randomBytes(16).toString("hex");
    await server.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)", person.id, person.email, person.id, person.role, `${salt}:${pbkdf2Sync(PASSWORD, salt, 310000, 32, "sha256").toString("hex")}`);
  }
});
after(async () => {
  await server?.stop();
});

const login = (client, email, password = PASSWORD) => client.post("/api/platform/login", { email, password });
async function as(person) {
  const client = new Client(server.baseUrl);
  const result = await login(client, person.email);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return client;
}
const page = (client, path) => client.request("GET", path, undefined, { raw: true });
const attempts = (email) => server.query("SELECT outcome FROM sign_in_attempts WHERE identifier = ? ORDER BY at", email);
async function rejectedForApp(statement) {
  await server.query("BEGIN");
  try {
    await server.query("SET LOCAL ROLE pharm_app");
    await assert.rejects(server.query(statement), (error) => error.code === "42501", statement);
  } finally {
    await server.query("ROLLBACK");
  }
}
const copyOf = (client) => {
  const copy = new Client(server.baseUrl);
  copy.cookies = new Map(client.cookies);
  return copy;
};

describe("Sessions", () => {
  test("a sign-in creates a server-side session; signing out ends it, so a copied cookie stops working", async () => {
    const client = await as(STAFF.support);
    const [session] = await server.query("SELECT user_id, ip, user_agent, two_factor, revoked_at FROM platform_sessions WHERE user_id = ?", STAFF.support.id);
    assert.deepEqual([session.user_id, session.two_factor, session.revoked_at], [STAFF.support.id, false, null]);
    const stolen = copyOf(client);
    assert.equal((await stolen.get("/api/platform/tenants")).status, 200);
    await client.post("/api/platform/logout");
    assert.equal((await stolen.get("/api/platform/tenants")).status, 401);
  });

  test("sessions end when idle too long or past their length", async () => {
    const client = await as(STAFF.support);
    assert.equal((await client.get("/api/platform/tenants")).status, 200);
    await server.query("UPDATE platform_sessions SET last_seen_at = now() - interval '2 hours' WHERE user_id = ? AND revoked_at IS NULL", STAFF.support.id);
    assert.equal((await client.get("/api/platform/tenants")).status, 401, "idle for longer than 60 minutes");
    const again = await as(STAFF.support);
    await server.query("UPDATE platform_sessions SET expires_at = now() - interval '1 minute' WHERE user_id = ? AND revoked_at IS NULL", STAFF.support.id);
    assert.equal((await again.get("/api/platform/tenants")).status, 401, "past the session length");
  });

  test("people end their own sessions; only Super Admins end other people's", async () => {
    const support = await as(STAFF.support);
    const billing = await as(STAFF.billing);
    const [billingSession] = await server.query("SELECT id FROM platform_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1", STAFF.billing.id);
    assert.equal((await support.delete(`/api/platform/sessions/${billingSession.id}`)).status, 403);
    const admin = await as(STAFF.super);
    const html = await (await page(admin, "/platform/settings/security")).text();
    assert.match(html, new RegExp(`data-session="${billingSession.id}"`));
    assert.equal((await admin.delete(`/api/platform/sessions/${billingSession.id}`)).status, 200);
    assert.equal((await billing.get("/api/platform/tenants")).status, 401);
    const [audit] = await server.query("SELECT severity FROM platform_audit_events WHERE action = 'security.session-revoke'");
    assert.equal(audit.severity, "warning");
  });
});

describe("Sign-in log and lockout", () => {
  test("failed attempts are logged and lock the account (even the right password) for the lockout time", async () => {
    const client = new Client(server.baseUrl);
    for (let index = 0; index < 5; index += 1) assert.equal((await login(client, STAFF.locked.email, "wrong-password")).status, 401);
    const blocked = await login(client, STAFF.locked.email);
    assert.equal(blocked.status, 429);
    assert.match(blocked.data.error, /Try again in \d+ minute/);
    assert.deepEqual((await attempts(STAFF.locked.email)).map((row) => row.outcome), [...Array(5).fill("bad_password"), "locked"]);
    await server.query("UPDATE sign_in_attempts SET at = at - interval '20 minutes' WHERE identifier = ?", STAFF.locked.email);
    assert.equal((await login(client, STAFF.locked.email)).status, 200, "the lockout ends");
    assert.equal((await login(new Client(server.baseUrl), STAFF.locked.email, "wrong-password")).status, 401);
    assert.equal((await login(new Client(server.baseUrl), STAFF.locked.email)).status, 200, "a success resets the count");
  });

  test("pharmacy sign-ins are logged too, with the pharmacy", async () => {
    const client = new Client(server.baseUrl);
    assert.notEqual(await client.login("admin@web365.ng", "HQ", "wrong-password"), null);
    assert.equal(await client.login("admin@web365.ng", "HQ"), null);
    const rows = await server.query("SELECT outcome, tenant_id FROM sign_in_attempts WHERE surface = 'pharmacy' AND identifier = 'admin@web365.ng' ORDER BY at");
    assert.deepEqual(rows.map((row) => row.outcome).slice(-2), ["bad_password", "success"]);
    assert.equal(rows.at(-1).tenant_id, "tenant-demo");
  });

  test("the security log shows attempts and events to staff with audit access", async () => {
    const support = await as(STAFF.support);
    const html = await (await page(support, "/platform/security/log?surface=platform&outcome=locked")).text();
    assert.match(html, /data-sign-in-log/);
    assert.match(html, /locked@web365\.ng/);
    assert.match(html, /locked out/);
    assert.ok(!html.includes("admin@web365.ng"), "filtered to platform lockouts");
    assert.equal((await page(support, "/platform/settings/security")).status, 307, "the policy is for Super Admins");
  });

  test("the application cannot change the sign-in log or delete sessions", async () => {
    await rejectedForApp("UPDATE sign_in_attempts SET outcome = 'success'");
    await rejectedForApp("DELETE FROM sign_in_attempts");
    await rejectedForApp("DELETE FROM platform_sessions");
  });
});

describe("Two-factor sign-in", () => {
  let secret;
  let recoveryCodes;

  test("setup shows a QR code; the secret is stored encrypted and only a correct code turns it on", async () => {
    const admin = await as(STAFF.super);
    const begun = await admin.post("/api/platform/me/two-factor", { action: "begin" });
    assert.equal(begun.status, 200, JSON.stringify(begun.data));
    secret = begun.data.secret;
    assert.match(begun.data.qrSvg, /^<svg/);
    assert.match(begun.data.uri, /^otpauth:\/\/totp\/Web365%20Platform%3Asuper%40web365\.ng\?secret=/);
    const [row] = await server.query("SELECT totp_secret_ciphertext, totp_enabled_at FROM platform_users WHERE id = ?", STAFF.super.id);
    assert.match(row.totp_secret_ciphertext, /^v1:/);
    assert.ok(!row.totp_secret_ciphertext.includes(secret));
    assert.equal(row.totp_enabled_at, null, "not on until confirmed");
    assert.equal((await admin.post("/api/platform/me/two-factor", { action: "confirm", code: "000000" })).status, 400);
    const confirmed = await admin.post("/api/platform/me/two-factor", { action: "confirm", code: totp(secret) });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    recoveryCodes = confirmed.data.recoveryCodes;
    superCodes = recoveryCodes;
    assert.equal(recoveryCodes.length, 10);
    const status = await admin.get("/api/platform/me/two-factor");
    assert.deepEqual([status.data.enabled, status.data.recoveryCodesLeft], [true, 10]);
    assert.ok(!JSON.stringify(status.data).includes(secret), "never shown again");
    const [stored] = await server.query("SELECT recovery_codes::text AS codes FROM platform_users WHERE id = ?", STAFF.super.id);
    assert.ok(!recoveryCodes.some((code) => stored.codes.includes(code) || stored.codes.includes(code.replace("-", ""))), "only hashes are stored");
  });

  test("with it on, a password alone opens no session; the code does, and a code cannot be used twice", async () => {
    const client = new Client(server.baseUrl);
    const first = await login(client, STAFF.super.email);
    assert.deepEqual([first.status, first.data.twoFactor], [200, true]);
    assert.ok(!client.cookies.has("pharm_platform"), "no session yet");
    assert.equal((await client.get("/api/platform/tenants")).status, 401);
    assert.equal((await client.post("/api/platform/login/verify", { code: "123456" })).status, 401);
    const code = totp(secret, 1); // the next step: the setup code used the current one
    const verified = await client.post("/api/platform/login/verify", { code });
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    assert.equal((await client.get("/api/platform/tenants")).status, 200);
    const [session] = await server.query("SELECT two_factor FROM platform_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", STAFF.super.id);
    assert.equal(session.two_factor, true);

    const replay = new Client(server.baseUrl);
    await login(replay, STAFF.super.email);
    assert.equal((await replay.post("/api/platform/login/verify", { code })).status, 401, "the same code is refused");
    assert.equal((await new Client(server.baseUrl).post("/api/platform/login/verify", { code: totp(secret) })).status, 401, "no password step, no sign-in");
  });

  test("a recovery code signs in once", async () => {
    const client = new Client(server.baseUrl);
    await login(client, STAFF.super.email);
    const used = await client.post("/api/platform/login/verify", { code: recoveryCodes[0].toLowerCase() });
    assert.equal(used.status, 200, JSON.stringify(used.data));
    assert.equal(used.data.usedRecoveryCode, true);
    const again = new Client(server.baseUrl);
    await login(again, STAFF.super.email);
    assert.equal((await again.post("/api/platform/login/verify", { code: recoveryCodes[0] })).status, 401);
    assert.equal((await client.get("/api/platform/me/two-factor")).data.recoveryCodesLeft, 9);
  });

  test("a Super Admin can reset someone's two-factor (lost phone); their sessions end", async () => {
    const support = await as(STAFF.support);
    const begun = await support.post("/api/platform/me/two-factor", { action: "begin" });
    await support.post("/api/platform/me/two-factor", { action: "confirm", code: totp(begun.data.secret) });
    const admin = new Client(server.baseUrl);
    await login(admin, STAFF.super.email);
    await admin.post("/api/platform/login/verify", { code: recoveryCodes[1] });
    assert.equal((await admin.request("DELETE", `/api/platform/users/${STAFF.support.id}/two-factor`, { reason: "x" })).status, 400);
    assert.equal((await admin.request("DELETE", `/api/platform/users/${STAFF.support.id}/two-factor`, { reason: "Lost phone, confirmed by call" })).status, 200);
    assert.equal((await support.get("/api/platform/tenants")).status, 401);
    const [row] = await server.query("SELECT totp_enabled_at FROM platform_users WHERE id = ?", STAFF.support.id);
    assert.equal(row.totp_enabled_at, null);
    const [audit] = await server.query("SELECT severity FROM platform_audit_events WHERE action = 'security.two-factor-reset'");
    assert.equal(audit.severity, "critical");
    assert.deepEqual([(await login(new Client(server.baseUrl), STAFF.support.email)).data.twoFactor], [undefined], "password only again");
  });

  test("the secret and recovery codes never reach logs or the audit trail", async () => {
    const audit = await server.query("SELECT summary FROM platform_audit_events");
    for (const text of [server.logs(), ...audit.map((row) => row.summary)]) {
      assert.ok(!text.includes(secret), "secret leaked");
      for (const code of recoveryCodes) assert.ok(!text.includes(code), "recovery code leaked");
    }
  });
});

describe("Security policy", () => {
  let next = 2; // recovery codes 0 and 1 were used above
  async function superAdmin() {
    const client = new Client(server.baseUrl);
    assert.equal((await login(client, STAFF.super.email)).data.twoFactor, true);
    assert.equal((await client.post("/api/platform/login/verify", { code: superCodes[next++] })).status, 200);
    return client;
  }
  const policy = (client, value) => client.request("PUT", "/api/platform/settings/security.policy", { value: { requireTwoFactor: false, sessionHours: 8, idleMinutes: 60, maxFailedAttempts: 5, lockoutMinutes: 15, ipAllowlist: [], ...value } });

  test("when two-factor is required, people without it can only reach their security page until they set it up", async () => {
    const admin = await superAdmin();
    assert.equal((await policy(await as(STAFF.billing), { requireTwoFactor: true })).status, 403, "Super Admins only");
    assert.equal((await policy(admin, { requireTwoFactor: true })).status, 200);
    const billing = await as(STAFF.billing);
    const blocked = await billing.get("/api/platform/tenants");
    assert.deepEqual([blocked.status, blocked.data.pending], [403, "two_factor_setup"]);
    const home = await page(billing, "/platform");
    assert.equal(home.status, 307);
    assert.match(home.headers.get("location"), /\/platform\/security$/);
    assert.match(await (await page(billing, "/platform/security")).text(), /data-pending="two_factor_setup"/);
    const begun = await billing.post("/api/platform/me/two-factor", { action: "begin" });
    assert.equal((await billing.post("/api/platform/me/two-factor", { action: "confirm", code: totp(begun.data.secret) })).status, 200);
    assert.equal((await billing.get("/api/platform/tenants")).status, 200, "set up: in");
    assert.equal((await admin.get("/api/platform/tenants")).status, 200, "people who have it are not affected");
    assert.equal((await policy(admin, {})).status, 200);
  });

  test("a temporary password must be changed at the first sign-in; other sessions end with the change", async () => {
    const admin = await superAdmin();
    const created = await admin.post("/api/platform/users", { name: "Kemi Ade", email: "kemi@web365.ng", role: "PLATFORM_SUPPORT" });
    assert.equal(created.status, 201);
    const kemi = new Client(server.baseUrl);
    assert.equal((await login(kemi, "kemi@web365.ng", created.data.temporaryPassword)).status, 200);
    const other = new Client(server.baseUrl);
    await login(other, "kemi@web365.ng", created.data.temporaryPassword);
    const blocked = await kemi.get("/api/platform/tenants");
    assert.deepEqual([blocked.status, blocked.data.pending], [403, "change_password"]);
    assert.match(await (await page(kemi, "/platform/security")).text(), /data-pending="change_password"/);
    assert.equal((await kemi.post("/api/platform/me/password", { current: created.data.temporaryPassword, next: "short1" })).status, 400);
    assert.equal((await kemi.post("/api/platform/me/password", { current: "wrong", next: "Harbour-Lantern-2026" })).status, 403);
    assert.equal((await kemi.post("/api/platform/me/password", { current: created.data.temporaryPassword, next: "Harbour-Lantern-2026" })).status, 200);
    assert.equal((await kemi.get("/api/platform/tenants")).status, 200, "this device continues");
    assert.equal((await other.get("/api/platform/tenants")).status, 401, "other sessions ended");
    assert.equal((await login(new Client(server.baseUrl), "kemi@web365.ng", created.data.temporaryPassword)).status, 401);
  });

  test("an IP allowlist limits the Control Centre to listed addresses, and cannot lock out the person saving it", async () => {
    const admin = await superAdmin();
    admin.headers = { "x-forwarded-for": "10.1.2.3" };
    const outside = await policy(admin, { ipAllowlist: ["192.168.0.0/16"] });
    assert.equal(outside.status, 400);
    assert.match(outside.data.error, /10\.1\.2\.3/);
    assert.equal((await policy(admin, { ipAllowlist: ["999.1.1.1"] })).status, 422);
    assert.equal((await policy(admin, { ipAllowlist: ["10.0.0.0/8", "2001:db8::/32"] })).status, 200);
    assert.equal((await admin.get("/api/platform/tenants")).status, 200, "inside the range");
    const stranger = new Client(server.baseUrl);
    stranger.headers = { "x-forwarded-for": "172.16.0.5" };
    const refused = await login(stranger, STAFF.support.email);
    assert.equal(refused.status, 403);
    assert.equal((await attempts(STAFF.support.email)).at(-1).outcome, "blocked_ip");
    admin.headers = { "x-forwarded-for": "172.16.0.5" };
    assert.equal((await admin.get("/api/platform/tenants")).status, 401, "an existing session from outside is refused too");
    assert.equal(await new Client(server.baseUrl).login("admin@web365.ng", "HQ"), null, "pharmacies are not affected");
    admin.headers = { "x-forwarded-for": "10.9.9.9" };
    assert.equal((await policy(admin, {})).status, 200);
    admin.headers = {};
    assert.equal((await admin.get("/api/platform/tenants")).status, 200);
  });
});
