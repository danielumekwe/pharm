// Web365 platform staff sessions: a separate cookie, encrypted with a key derived for the platform only, so a
// pharmacy session can never be used as a platform session (or the reverse). Platform staff have no
// pharmacy membership and therefore no access to pharmacy records.
import { decode, encode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_SECRET } from "@/lib/auth-secret";
import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { verifyPassword } from "@/lib/password";
import { RateLimitError } from "@/lib/saas/rate-limit";

export const PLATFORM_COOKIE = "pharm_platform";
const SECRET = `${AUTH_SECRET}:web365-platform`;

export type PlatformRole = "PLATFORM_SUPER_ADMIN" | "PLATFORM_SUPPORT" | "BILLING_ADMIN" | "TECHNICAL_ADMIN";
export type PlatformPermission =
  | "dashboard.view"
  | "tenants.view"
  | "tenants.manage"
  | "plans.manage"
  | "billing.manage"
  | "settings.manage"
  | "support.request"
  | "audit.view"
  | "staff.manage"
  | "support.tickets"
  | "content.manage";

export type PlatformActor = {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  /** The current session (absent for actors built outside a request). */
  sessionId?: string;
  /** Signed in with a second factor in this session. */
  twoFactor?: boolean;
  /** Something the person must do before using the Control Centre. */
  pending?: "change_password" | "two_factor_setup" | null;
};

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  PLATFORM_SUPER_ADMIN: "Platform Super Admin",
  PLATFORM_SUPPORT: "Platform Support",
  BILLING_ADMIN: "Billing Administrator",
  TECHNICAL_ADMIN: "Technical Administrator",
};
/** Least privilege: each role gets only what its job needs. */
const ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  PLATFORM_SUPER_ADMIN: ["dashboard.view", "tenants.view", "tenants.manage", "plans.manage", "billing.manage", "settings.manage", "support.request", "audit.view", "staff.manage", "support.tickets", "content.manage"],
  PLATFORM_SUPPORT: ["dashboard.view", "tenants.view", "support.request", "audit.view", "support.tickets", "content.manage"],
  BILLING_ADMIN: ["dashboard.view", "tenants.view", "plans.manage", "billing.manage", "audit.view"],
  TECHNICAL_ADMIN: ["dashboard.view", "tenants.view", "settings.manage", "audit.view"],
};

export function platformCan(actor: PlatformActor, permission: PlatformPermission) {
  return ROLE_PERMISSIONS[actor.role]?.includes(permission) ?? false;
}

type Row = { id: string; email: string; name: string; role: PlatformRole; status: string; password_hash: string; password_changed_at: Date | null; totp_enabled_at: Date | null; password_must_change: boolean };
const USER_COLUMNS = `id, email, name, role, status, password_hash, password_changed_at, totp_enabled_at, password_must_change`;

/**
 * Checks a platform password. Returns the account (and whether a second factor is needed) or null. Nothing is
 * recorded here: the sign-in route logs the attempt and starts the session.
 */
export async function verifyPlatformCredentials(email: string, password: string) {
  const [row] = await platformQuery<Row[]>((query) => query<Row>(`SELECT ${USER_COLUMNS} FROM platform_users WHERE email = lower($1)`, [email.trim()]));
  if (!row || row.status !== "ACTIVE" || !verifyPassword(password, row.password_hash)) return { actor: null, userId: row?.id ?? null } as const;
  return { actor: { id: row.id, name: row.name, email: row.email, role: row.role } satisfies PlatformActor, userId: row.id, twoFactor: Boolean(row.totp_enabled_at) } as const;
}

/** Creates a server-side session and adds its cookie to the response. */
export async function startPlatformSession(response: NextResponse, actor: Pick<PlatformActor, "id">, request: Request, options: { twoFactor: boolean }) {
  const { createPlatformSession, securityPolicy } = await import("@/lib/platform/security");
  const policy = await securityPolicy();
  const session = await createPlatformSession(actor.id, options.twoFactor, policy);
  await platformQuery((query) => query(`UPDATE platform_users SET last_login_at = now() WHERE id = $1`, [actor.id]));
  const token = await encode({ token: { pid: actor.id, sid: session.id, signedInAt: Date.now(), platform: true }, secret: SECRET, maxAge: session.maxAgeSeconds });
  response.cookies.set(PLATFORM_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: session.maxAgeSeconds });
  return response;
}

// Between a correct password and a correct second factor: a short-lived cookie naming who is signing in.
const CHALLENGE_COOKIE = "pharm_platform_2fa";
const CHALLENGE_SECRET = `${SECRET}:two-factor-challenge`;
const CHALLENGE_SECONDS = 5 * 60;

export async function startTwoFactorChallenge(response: NextResponse, userId: string, request: Request) {
  const token = await encode({ token: { pid: userId, challenge: true }, secret: CHALLENGE_SECRET, maxAge: CHALLENGE_SECONDS });
  response.cookies.set(CHALLENGE_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/api/platform/login", maxAge: CHALLENGE_SECONDS });
  return response;
}

/** The account waiting for its second factor, if the challenge cookie is valid and not expired. */
export async function twoFactorChallengeUser(): Promise<string | null> {
  try {
    const value = (await cookies()).get(CHALLENGE_COOKIE)?.value;
    if (!value) return null;
    const payload = await decode({ token: value, secret: CHALLENGE_SECRET });
    return payload?.challenge === true && typeof payload.pid === "string" ? payload.pid : null;
  } catch {
    return null;
  }
}

export function endTwoFactorChallenge(response: NextResponse) {
  response.cookies.set(CHALLENGE_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/api/platform/login", maxAge: 0 });
  return response;
}

export function endPlatformSession(response: NextResponse) {
  response.cookies.set(PLATFORM_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}

/** The session id in the request's platform cookie (valid signature), if any. */
export async function platformSessionId(): Promise<string | null> {
  try {
    const value = (await cookies()).get(PLATFORM_COOKIE)?.value;
    if (!value) return null;
    const payload = await decode({ token: value, secret: SECRET });
    return payload?.platform === true && typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in platform user, re-read on every request: the session must exist, not be revoked, expired or
 * idle too long, and come from an allowed address; the account must be active. Suspension, password changes
 * and revoked sessions apply at once.
 */
export async function getPlatformActor(): Promise<PlatformActor | null> {
  let value: string | undefined;
  try {
    value = (await cookies()).get(PLATFORM_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!value) return null;
  let payload: Awaited<ReturnType<typeof decode>>;
  try {
    payload = await decode({ token: value, secret: SECRET });
  } catch {
    return null;
  }
  if (!payload || payload.platform !== true || typeof payload.pid !== "string" || typeof payload.sid !== "string") return null;
  const { clientAddress } = await import("@/lib/saas/rate-limit");
  const { ipAllowed, securityPolicy } = await import("@/lib/platform/security");
  const policy = await securityPolicy();
  if (!ipAllowed(await clientAddress(), policy.ipAllowlist)) return null;
  const [row] = await platformQuery<Array<Row & { last_seen_at: Date; session_two_factor: boolean }>>((query) =>
    query(
      `SELECT ${USER_COLUMNS.split(", ").map((column) => `u.${column}`).join(", ")}, s.last_seen_at, s.two_factor AS session_two_factor
       FROM platform_sessions s JOIN platform_users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - ($3::int * interval '1 minute')`,
      [payload.sid, payload.pid, policy.idleMinutes],
    ),
  );
  if (!row || row.status !== "ACTIVE") return null;
  if (row.password_changed_at && typeof payload.signedInAt === "number" && new Date(row.password_changed_at).getTime() > payload.signedInAt) return null;
  // Activity keeps the session alive (written at most once a minute).
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) await platformQuery((query) => query(`UPDATE platform_sessions SET last_seen_at = now() WHERE id = $1`, [payload.sid]));
  const pending: PlatformActor["pending"] = row.password_must_change ? "change_password" : policy.requireTwoFactor && !row.totp_enabled_at ? "two_factor_setup" : null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, sessionId: payload.sid, twoFactor: row.session_two_factor, pending };
}

/** Platform API wrapper: signed-in platform user with the permission, errors mapped to HTTP. No pharmacy data. */
export async function platformGuarded(permission: PlatformPermission | "self", handler: (actor: PlatformActor) => Promise<unknown>, successStatus = 200) {
  try {
    const actor = await getPlatformActor();
    if (!actor) return NextResponse.json({ error: "Platform sign-in required." }, { status: 401 });
    // "self": the person's own security settings, usable while a password change or two-factor setup is due.
    if (permission !== "self" && actor.pending) {
      return NextResponse.json({ error: actor.pending === "change_password" ? "Choose a new password first (Security page)." : "Set up two-factor sign-in first (Security page).", pending: actor.pending }, { status: 403 });
    }
    if (permission !== "self" && !platformCan(actor, permission)) return NextResponse.json({ error: "Your platform role does not allow this." }, { status: 403 });
    const result = await handler(actor);
    return result instanceof NextResponse ? result : NextResponse.json(result, { status: successStatus });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error && typeof error === "object" && "issues" in error) return NextResponse.json({ error: "Some fields are missing or invalid." }, { status: 422 });
    console.error("[platform]", error);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
