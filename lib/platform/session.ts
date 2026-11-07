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
const MAX_AGE = 8 * 60 * 60; // one working day

export type PlatformRole = "PLATFORM_SUPER_ADMIN" | "PLATFORM_SUPPORT";
export type PlatformPermission = "tenants.view" | "tenants.manage" | "plans.manage" | "support.request" | "audit.view" | "staff.manage";
export type PlatformActor = { id: string; name: string; email: string; role: PlatformRole };

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = { PLATFORM_SUPER_ADMIN: "Platform Super Admin", PLATFORM_SUPPORT: "Platform Support" };
const ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  PLATFORM_SUPER_ADMIN: ["tenants.view", "tenants.manage", "plans.manage", "support.request", "audit.view", "staff.manage"],
  PLATFORM_SUPPORT: ["tenants.view", "support.request", "audit.view"],
};

export function platformCan(actor: PlatformActor, permission: PlatformPermission) {
  return ROLE_PERMISSIONS[actor.role]?.includes(permission) ?? false;
}

type Row = { id: string; email: string; name: string; role: PlatformRole; status: string; password_hash: string; password_changed_at: Date | null };

/** Checks a platform sign-in. Returns the account or null. */
export async function verifyPlatformCredentials(email: string, password: string) {
  const [row] = await platformQuery<Row[]>((query) => query<Row>(`SELECT id, email, name, role, status, password_hash, password_changed_at FROM platform_users WHERE email = lower($1)`, [email.trim()]));
  if (!row || row.status !== "ACTIVE" || !verifyPassword(password, row.password_hash)) return null;
  await platformQuery((query) => query(`UPDATE platform_users SET last_login_at = now() WHERE id = $1`, [row.id]));
  return { id: row.id, name: row.name, email: row.email, role: row.role } satisfies PlatformActor;
}

/** Adds the platform session cookie to a response. */
export async function startPlatformSession(response: NextResponse, actor: PlatformActor, request: Request) {
  const token = await encode({ token: { pid: actor.id, signedInAt: Date.now(), platform: true }, secret: SECRET, maxAge: MAX_AGE });
  response.cookies.set(PLATFORM_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: MAX_AGE });
  return response;
}

export function endPlatformSession(response: NextResponse) {
  response.cookies.set(PLATFORM_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}

/** The signed-in platform user, re-read on every request (suspension and password changes apply at once). */
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
  if (!payload || payload.platform !== true || typeof payload.pid !== "string") return null;
  const [row] = await platformQuery<Row[]>((query) => query<Row>(`SELECT id, email, name, role, status, password_hash, password_changed_at FROM platform_users WHERE id = $1`, [payload.pid]));
  if (!row || row.status !== "ACTIVE") return null;
  if (row.password_changed_at && typeof payload.signedInAt === "number" && new Date(row.password_changed_at).getTime() > payload.signedInAt) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

/** Platform API wrapper: signed-in platform user with the permission, errors mapped to HTTP. No pharmacy data. */
export async function platformGuarded(permission: PlatformPermission, handler: (actor: PlatformActor) => Promise<unknown>, successStatus = 200) {
  try {
    const actor = await getPlatformActor();
    if (!actor) return NextResponse.json({ error: "Platform sign-in required." }, { status: 401 });
    if (!platformCan(actor, permission)) return NextResponse.json({ error: "Your platform role does not allow this." }, { status: 403 });
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
