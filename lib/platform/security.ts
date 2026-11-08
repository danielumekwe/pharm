// Platform security: the sign-in log (and lockout from it, which works across server instances), the
// Control Centre IP allowlist, server-side sessions, two-factor sign-in with an authenticator app, recovery
// codes, and password changes for Web365 staff.
import { randomUUID } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { headers } from "next/headers";
import QRCode from "qrcode";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { hashPassword, verifyPassword } from "@/lib/password";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { decryptSecrets, encryptSecrets, secretsAvailable } from "@/lib/platform/secrets";
import type { PlatformActor } from "@/lib/platform/session";
import { readPlatformSetting, type SettingValue } from "@/lib/platform/settings";
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "@/lib/platform/totp";
import { clientAddress } from "@/lib/saas/rate-limit";

export type SecurityPolicy = SettingValue<"security.policy">;
const DEFAULT_POLICY: SecurityPolicy = { requireTwoFactor: false, sessionHours: 8, idleMinutes: 60, maxFailedAttempts: 5, lockoutMinutes: 15, ipAllowlist: [] };

/** Read fresh each time (settings can change on any server instance). */
export async function securityPolicy(): Promise<SecurityPolicy> {
  try {
    return (await readPlatformSetting("security.policy")).value;
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function clientInfo() {
  let userAgent: string | null = null;
  try {
    userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  } catch {
    // outside a request
  }
  return { ip: await clientAddress(), userAgent };
}

// ── IP allowlist ─────────────────────────────────────────────────────────────────────────────────────────

export function ipAllowed(ip: string, allowlist: string[]) {
  if (!allowlist.length) return true;
  const family = isIP(ip);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of allowlist) {
    const [address, bits] = entry.split("/");
    const type = isIP(address) === 6 ? "ipv6" : "ipv4";
    if (bits === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(bits), type);
  }
  return list.check(ip, family === 6 ? "ipv6" : "ipv4");
}

// ── Sign-in log and lockout ──────────────────────────────────────────────────────────────────────────────

export type SignInOutcome = "success" | "two_factor_required" | "bad_password" | "two_factor_failed" | "locked" | "rate_limited" | "blocked_ip" | "refused";

/** Best effort: a logging problem never blocks or breaks a sign-in. */
export async function recordSignInAttempt(entry: { surface: "platform" | "pharmacy"; identifier: string; outcome: SignInOutcome; userId?: string | null; tenantId?: string | null; detail?: string | null }) {
  try {
    const { ip, userAgent } = await clientInfo();
    await platformQuery((query) =>
      query(
        `INSERT INTO sign_in_attempts (id, surface, identifier, user_id, tenant_id, ip, user_agent, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [`sia-${randomUUID()}`, entry.surface, entry.identifier.trim().toLowerCase().slice(0, 160), entry.userId ?? null, entry.tenantId ?? null, ip, userAgent, entry.outcome, entry.detail?.slice(0, 300) ?? null],
      ),
      // Committed on its own: a failed attempt is logged even when the surrounding transaction rolls back.
      { independent: true },
    );
  } catch (error) {
    console.error("[security] could not log a sign-in attempt", error instanceof Error ? error.name : "error");
  }
}

/** Failures since the last success within the window. */
async function recentFailures(surface: "platform" | "pharmacy", identifier: string, windowMinutes: number) {
  const [row] = await platformQuery<Array<{ failures: string; last_failure: Date | null }>>((query) =>
    query(
      `SELECT count(*) AS failures, max(at) AS last_failure FROM sign_in_attempts
       WHERE surface = $1 AND identifier = $2 AND outcome IN ('bad_password', 'two_factor_failed') AND at > now() - ($3::int * interval '1 minute')
         AND at > coalesce((SELECT max(at) FROM sign_in_attempts WHERE surface = $1 AND identifier = $2 AND outcome = 'success'), '-infinity')`,
      [surface, identifier.trim().toLowerCase(), windowMinutes],
    ),
    { independent: true },
  );
  return { failures: Number(row?.failures ?? 0), lastFailure: row?.last_failure ? new Date(row.last_failure) : null };
}

/** Minutes until a locked platform account may try again, or null when it is not locked. */
export async function platformLockout(identifier: string, policy: SecurityPolicy) {
  const { failures, lastFailure } = await recentFailures("platform", identifier, policy.lockoutMinutes);
  if (failures < policy.maxFailedAttempts || !lastFailure) return null;
  return Math.max(1, Math.ceil((lastFailure.getTime() + policy.lockoutMinutes * 60_000 - Date.now()) / 60_000));
}

/** Pharmacy sign-in: 10 failures per account name in 15 minutes, counted across all server instances. */
export async function pharmacyLockedOut(identifier: string) {
  if (process.env.RATE_LIMIT === "off") return false;
  return (await recentFailures("pharmacy", identifier, 15)).failures >= 10;
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────────────────

export async function createPlatformSession(userId: string, twoFactor: boolean, policy: SecurityPolicy) {
  const id = `psess-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + policy.sessionHours * 3_600_000);
  const { ip, userAgent } = await clientInfo();
  await platformQuery((query) => query(`INSERT INTO platform_sessions (id, user_id, expires_at, ip, user_agent, two_factor) VALUES ($1, $2, $3, $4, $5, $6)`, [id, userId, expiresAt, ip, userAgent, twoFactor]));
  return { id, expiresAt, maxAgeSeconds: policy.sessionHours * 3600 };
}

type SessionRow = { id: string; user_id: string; user_name: string; user_email: string; created_at: Date; last_seen_at: Date; expires_at: Date; ip: string | null; user_agent: string | null; two_factor: boolean; revoked_at: Date | null; revoked_by_name: string | null; revoke_reason: string | null };
const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);
const sessionView = (row: SessionRow, idleMinutes: number) => ({
  id: row.id, userId: row.user_id, user: row.user_name, email: row.user_email, createdAt: iso(row.created_at)!, lastSeenAt: iso(row.last_seen_at)!, expiresAt: iso(row.expires_at)!,
  ip: row.ip, userAgent: row.user_agent, twoFactor: row.two_factor, revokedAt: iso(row.revoked_at), revokedBy: row.revoked_by_name, reason: row.revoke_reason,
  active: !row.revoked_at && new Date(row.expires_at).getTime() > Date.now() && new Date(row.last_seen_at).getTime() > Date.now() - idleMinutes * 60_000,
});

/** Sessions still in force (one person's, or everyone's). */
export async function activeSessions(userId?: string) {
  const policy = await securityPolicy();
  const rows = await platformQuery<SessionRow[]>((query) =>
    query(
      `SELECT s.*, u.name AS user_name, u.email AS user_email FROM platform_sessions s JOIN platform_users u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - ($2::int * interval '1 minute') AND ($1::text IS NULL OR s.user_id = $1)
       ORDER BY s.last_seen_at DESC LIMIT 200`,
      [userId ?? null, policy.idleMinutes],
    ),
  );
  return rows.map((row) => sessionView(row, policy.idleMinutes));
}

export async function revokeSession(actor: PlatformActor, sessionId: string, mayRevokeOthers: boolean, reason = "Signed out by staff") {
  const [row] = await platformQuery<Array<{ user_id: string; user_name: string }>>((query) => query(`SELECT s.user_id, u.name AS user_name FROM platform_sessions s JOIN platform_users u ON u.id = s.user_id WHERE s.id = $1 AND s.revoked_at IS NULL`, [sessionId]));
  if (!row) throw new DomainError("Session not found or already ended.", 404);
  if (row.user_id !== actor.id && !mayRevokeOthers) throw new DomainError("You can only end your own sessions.", 403);
  await platformQuery((query) => query(`UPDATE platform_sessions SET revoked_at = now(), revoked_by_name = $1, revoke_reason = $2 WHERE id = $3`, [actor.name, reason, sessionId]));
  await recordPlatformAudit(platformActorRef(actor), { action: "security.session-revoke", targetType: "PlatformSession", targetId: sessionId, severity: row.user_id === actor.id ? "info" : "warning", summary: row.user_id === actor.id ? `Ended one of their own sessions` : `Ended a session of ${row.user_name}: ${reason}` });
  return { ok: true };
}

/** Ends every session of a person (optionally keeping one). */
export async function revokeUserSessions(userId: string, byName: string, reason: string, exceptSessionId?: string) {
  const rows = await platformQuery<Array<{ id: string }>>((query) =>
    query(`UPDATE platform_sessions SET revoked_at = now(), revoked_by_name = $1, revoke_reason = $2 WHERE user_id = $3 AND revoked_at IS NULL AND ($4::text IS NULL OR id <> $4) RETURNING id`, [byName, reason, userId, exceptSessionId ?? null]),
  );
  return rows.length;
}

// ── Two-factor sign-in ───────────────────────────────────────────────────────────────────────────────────

type FactorRow = { id: string; name: string; email: string; password_hash: string; totp_secret_ciphertext: string | null; totp_enabled_at: Date | null; totp_last_step: string | null; recovery_codes: Array<{ hash: string; usedAt: string | null }> | null };
async function factorRow(userId: string) {
  const [row] = await platformQuery<FactorRow[]>((query) => query(`SELECT id, name, email, password_hash, totp_secret_ciphertext, totp_enabled_at, totp_last_step, recovery_codes FROM platform_users WHERE id = $1`, [userId]));
  if (!row) throw new DomainError("Platform account not found.", 404);
  return row;
}
const secretOf = (row: FactorRow) => (row.totp_secret_ciphertext ? decryptSecrets(row.totp_secret_ciphertext).totp ?? null : null);

export async function twoFactorStatus(userId: string) {
  const row = await factorRow(userId);
  return { enabled: Boolean(row.totp_enabled_at), enabledAt: iso(row.totp_enabled_at), recoveryCodesLeft: (row.recovery_codes ?? []).filter((code) => !code.usedAt).length };
}

/** Step 1: a new secret (kept, not yet enabled) and the QR code to scan. */
export async function beginTwoFactorSetup(actor: PlatformActor) {
  if (!secretsAvailable()) throw new DomainError("Two-factor sign-in needs secret storage on the server (SETTINGS_ENCRYPTION_KEY).", 503);
  const row = await factorRow(actor.id);
  if (row.totp_enabled_at) throw new DomainError("Two-factor sign-in is already on. Turn it off first to move it to another device.", 409);
  const secret = newTotpSecret();
  await platformQuery((query) => query(`UPDATE platform_users SET totp_secret_ciphertext = $1, totp_last_step = NULL, updated_at = now() WHERE id = $2`, [encryptSecrets({ totp: secret }), actor.id]));
  const uri = otpauthUri(secret, actor.email);
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200, errorCorrectionLevel: "M" });
  return { secret, uri, qrSvg };
}

/** Step 2: the first code from the app turns it on; the recovery codes are returned this once. */
export async function confirmTwoFactorSetup(actor: PlatformActor, code: string) {
  const row = await factorRow(actor.id);
  if (row.totp_enabled_at) throw new DomainError("Two-factor sign-in is already on.", 409);
  const secret = secretOf(row);
  if (!secret) throw new DomainError("Start the setup again.", 409);
  const step = verifyTotp(secret, code, null);
  if (step === null) throw new DomainError("That code is not right. Check the time on your phone and try the newest code.", 400);
  const codes = newRecoveryCodes();
  await platformQuery((query) =>
    query(`UPDATE platform_users SET totp_enabled_at = now(), totp_last_step = $1, recovery_codes = $2, updated_at = now() WHERE id = $3`, [step, JSON.stringify(codes.map((value) => ({ hash: hashRecoveryCode(value), usedAt: null }))), actor.id]),
  );
  if (actor.sessionId) await platformQuery((query) => query(`UPDATE platform_sessions SET two_factor = true WHERE id = $1`, [actor.sessionId]));
  await recordPlatformAudit(platformActorRef(actor), { action: "security.two-factor-enabled", targetType: "PlatformUser", targetId: actor.id, summary: `${actor.name} turned on two-factor sign-in` });
  return { ok: true, recoveryCodes: codes };
}

/**
 * Checks a sign-in code: a 6-digit app code (not reused) or an unused recovery code, which is then spent.
 * Returns "totp", "recovery" or null.
 */
export async function verifySecondFactor(userId: string, input: string): Promise<"totp" | "recovery" | null> {
  const row = await factorRow(userId);
  const secret = secretOf(row);
  if (!row.totp_enabled_at || !secret) return null;
  const typed = input.trim();
  if (/^\d{3}\s?\d{3}$/.test(typed)) {
    const step = verifyTotp(secret, typed, row.totp_last_step === null ? null : Number(row.totp_last_step));
    if (step === null) return null;
    // Only one request can claim a step, so a code intercepted in flight cannot be used again.
    const claimed = await platformQuery<Array<{ id: string }>>((query) => query(`UPDATE platform_users SET totp_last_step = $1 WHERE id = $2 AND (totp_last_step IS NULL OR totp_last_step < $1) RETURNING id`, [step, userId]));
    return claimed.length ? "totp" : null;
  }
  const hash = hashRecoveryCode(typed);
  const codes = row.recovery_codes ?? [];
  const match = codes.find((code) => code.hash === hash && !code.usedAt);
  if (!match) return null;
  const updated = codes.map((code) => (code === match ? { ...code, usedAt: new Date().toISOString() } : code));
  const claimed = await platformQuery<Array<{ id: string }>>((query) =>
    query(`UPDATE platform_users SET recovery_codes = $1 WHERE id = $2 AND recovery_codes = $3::jsonb RETURNING id`, [JSON.stringify(updated), userId, JSON.stringify(codes)]),
  );
  return claimed.length ? "recovery" : null;
}

async function requirePasswordAndCode(actor: PlatformActor, password: string, code: string) {
  const row = await factorRow(actor.id);
  if (!verifyPassword(password, row.password_hash)) throw new DomainError("The password is not correct.", 403);
  if (!(await verifySecondFactor(actor.id, code))) throw new DomainError("That code is not right.", 403);
}

export async function disableTwoFactor(actor: PlatformActor, password: string, code: string) {
  await requirePasswordAndCode(actor, password, code);
  await platformQuery((query) => query(`UPDATE platform_users SET totp_secret_ciphertext = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = NULL, updated_at = now() WHERE id = $1`, [actor.id]));
  await recordPlatformAudit(platformActorRef(actor), { action: "security.two-factor-disabled", targetType: "PlatformUser", targetId: actor.id, severity: "warning", summary: `${actor.name} turned off two-factor sign-in` });
  return { ok: true };
}

export async function regenerateRecoveryCodes(actor: PlatformActor, password: string, code: string) {
  await requirePasswordAndCode(actor, password, code);
  const codes = newRecoveryCodes();
  await platformQuery((query) => query(`UPDATE platform_users SET recovery_codes = $1, updated_at = now() WHERE id = $2`, [JSON.stringify(codes.map((value) => ({ hash: hashRecoveryCode(value), usedAt: null }))), actor.id]));
  await recordPlatformAudit(platformActorRef(actor), { action: "security.recovery-codes", targetType: "PlatformUser", targetId: actor.id, summary: `${actor.name} replaced their recovery codes` });
  return { ok: true, recoveryCodes: codes };
}

/** A Platform Super Admin removes someone's two-factor setup (lost phone); all their sessions end. */
export async function resetTwoFactor(actor: PlatformActor, userId: string, reason: string) {
  if (userId === actor.id) throw new DomainError("Turn your own two-factor sign-in off on your Security page.");
  if (reason.trim().length < 5) throw new DomainError("Give a reason (at least 5 characters).");
  const row = await factorRow(userId);
  if (!row.totp_enabled_at && !row.totp_secret_ciphertext) throw new DomainError("This person does not use two-factor sign-in.", 409);
  await platformQuery((query) => query(`UPDATE platform_users SET totp_secret_ciphertext = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = NULL, updated_at = now() WHERE id = $1`, [userId]));
  const ended = await revokeUserSessions(userId, actor.name, "Two-factor sign-in was reset");
  await recordPlatformAudit(platformActorRef(actor), { action: "security.two-factor-reset", targetType: "PlatformUser", targetId: userId, severity: "critical", summary: `Reset two-factor sign-in for ${row.name} (${ended} session(s) ended): ${reason.trim()}` });
  return { ok: true };
}

// ── Passwords ────────────────────────────────────────────────────────────────────────────────────────────

export function passwordProblem(password: string, email: string) {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "Use letters and at least one number.";
  if (password.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "Do not use your email name in the password.";
  return null;
}

/** Changes the staff member's own password. Every session ends; the caller starts a new one for this device. */
export async function changePlatformPassword(actor: PlatformActor, current: string, next: string) {
  const row = await factorRow(actor.id);
  if (!verifyPassword(current, row.password_hash)) throw new DomainError("The current password is not correct.", 403);
  const problem = passwordProblem(next, row.email);
  if (problem) throw new DomainError(problem, 400);
  if (verifyPassword(next, row.password_hash)) throw new DomainError("Choose a password you have not used here before.", 400);
  await platformQuery((query) => query(`UPDATE platform_users SET password_hash = $1, password_changed_at = now(), password_must_change = false, updated_at = now() WHERE id = $2`, [hashPassword(next), actor.id]));
  const ended = await revokeUserSessions(actor.id, actor.name, "Password changed");
  await recordPlatformAudit(platformActorRef(actor), { action: "security.password-change", targetType: "PlatformUser", targetId: actor.id, summary: `${actor.name} changed their password (${ended} session(s) ended)` });
  return { ok: true };
}

// ── Monitoring ───────────────────────────────────────────────────────────────────────────────────────────

export async function signInLog(filters: { surface?: string; outcome?: string; identifier?: string }) {
  const rows = await platformQuery<Array<{ at: Date; surface: string; identifier: string; ip: string | null; user_agent: string | null; outcome: string; detail: string | null; tenant: string | null }>>((query) =>
    query(
      `SELECT a.at, a.surface, a.identifier, a.ip, a.user_agent, a.outcome, a.detail, t.name AS tenant FROM sign_in_attempts a LEFT JOIN tenants t ON t.id = a.tenant_id
       WHERE ($1::text IS NULL OR a.surface = $1) AND ($2::text IS NULL OR a.outcome = $2) AND ($3::text IS NULL OR a.identifier = $3)
       ORDER BY a.at DESC LIMIT 300`,
      [filters.surface ?? null, filters.outcome ?? null, filters.identifier?.trim().toLowerCase() || null],
    ),
  );
  return rows.map((row) => ({ ...row, at: iso(row.at)! }));
}

export async function signInSummary() {
  const [totals] = await platformQuery<Array<Record<string, string>>>((query) =>
    query(
      `SELECT count(*) FILTER (WHERE surface = 'platform' AND outcome = 'success') AS platform_ok,
              count(*) FILTER (WHERE surface = 'platform' AND outcome IN ('bad_password', 'two_factor_failed')) AS platform_failed,
              count(*) FILTER (WHERE surface = 'pharmacy' AND outcome = 'success') AS pharmacy_ok,
              count(*) FILTER (WHERE surface = 'pharmacy' AND outcome = 'bad_password') AS pharmacy_failed,
              count(*) FILTER (WHERE outcome IN ('locked', 'rate_limited', 'blocked_ip')) AS blocked
       FROM sign_in_attempts WHERE at > now() - interval '24 hours'`,
    ),
  );
  const addresses = await platformQuery<Array<{ ip: string; failures: string }>>((query) =>
    query(`SELECT ip, count(*) AS failures FROM sign_in_attempts WHERE at > now() - interval '24 hours' AND outcome IN ('bad_password', 'two_factor_failed', 'locked', 'rate_limited') AND ip IS NOT NULL GROUP BY ip HAVING count(*) >= 3 ORDER BY 2 DESC LIMIT 10`),
  );
  const n = (key: string) => Number(totals?.[key] ?? 0);
  return {
    platformOk: n("platform_ok"), platformFailed: n("platform_failed"), pharmacyOk: n("pharmacy_ok"), pharmacyFailed: n("pharmacy_failed"), blocked: n("blocked"),
    suspiciousAddresses: addresses.map((row) => ({ ip: row.ip, failures: Number(row.failures) })),
  };
}

export async function securityEvents() {
  const rows = await platformQuery<Array<{ at: Date; actor_name: string; action: string; summary: string; severity: string; ip: string | null }>>((query) =>
    query(`SELECT at, actor_name, action, summary, severity, ip FROM platform_audit_events WHERE action LIKE 'security.%' OR action LIKE 'platform.login%' OR action LIKE 'platform.staff-%' ORDER BY at DESC LIMIT 100`),
  );
  return rows.map((row) => ({ ...row, at: iso(row.at)! }));
}
