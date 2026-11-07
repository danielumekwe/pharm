// Web365 support access to a pharmacy: explicit, time-limited, read-only and audited.
//
// 1. A platform user requests access with a reason and a duration (15 minutes to 8 hours).
// 2. The pharmacy's Super Admins are notified; one of them approves (or denies). The clock starts on approval.
// 3. The requester opens a support session: a pharmacy session cookie for a synthetic, read-only identity.
//    Every request re-checks the grant; the database refuses to save changes (only audit entries).
// 4. The pharmacy can revoke at any time. Every step is recorded in the pharmacy's and the platform's audit.
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { NextResponse } from "next/server";

import { AUTH_SECRET } from "@/lib/auth-secret";
import { currentTenant, platformQuery, withDatabaseTransaction } from "@/lib/db/database";
import { outlets, users } from "@/lib/data";
import { newId } from "@/lib/erp/ids";
import { DomainError, recordAudit } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { effectiveGrantStatus } from "@/lib/platform/tenants";
import type { PlatformActor } from "@/lib/platform/session";
import { ALL_PERMISSIONS, type Permission } from "@/lib/rbac";
import { runInTenant } from "@/lib/saas/tenant";

/** Everything a support agent may look at: view permissions and reports, nothing that changes data. */
export const SUPPORT_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((permission) => permission.endsWith(".view") || permission.startsWith("reports.") || permission === "stock.levels");

export const SUPPORT_PREFIX = "support:";

type GrantRow = { id: string; tenant_id: string; requested_by: string; reason: string; duration_minutes: number; status: string; requested_at: Date; decided_at: Date | null; expires_at: Date | null; requester_name: string };
const GRANT_SELECT = `SELECT g.*, p.name AS requester_name FROM support_access_grants g JOIN platform_users p ON p.id = g.requested_by`;

function supportIdentity(platformUserId: string, name: string) {
  return { id: `${SUPPORT_PREFIX}${platformUserId}`, name: `Web365 Support (${name})`, role: "PHARMACY_MANAGER" as const };
}

// ---------------------------------------------------------------- platform side

export async function requestSupportAccess(actor: PlatformActor, tenantId: string, reason: string, minutes: number) {
  if (reason.trim().length < 10) throw new DomainError("Explain why access is needed (at least 10 characters); the pharmacy sees this.");
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) throw new DomainError("Ask for 15 minutes to 8 hours.");
  const [tenant] = await platformQuery<Array<{ name: string; status: string }>>((query) => query(`SELECT name, status FROM tenants WHERE id = $1`, [tenantId]));
  if (!tenant) throw new DomainError("Pharmacy not found.", 404);
  const id = `grant-${randomUUID()}`;
  await platformQuery((query) => query(`INSERT INTO support_access_grants (id, tenant_id, requested_by, reason, duration_minutes) VALUES ($1, $2, $3, $4, $5)`, [id, tenantId, actor.id, reason.trim(), minutes]));

  // The pharmacy's Super Admins are told in the app, and the request is in their audit trail.
  await runInTenant(tenantId, () => withDatabaseTransaction(() => {
    const store = getStore();
    const at = new Date().toISOString();
    for (const admin of users.filter((user) => user.role === "SUPER_ADMIN" && (user.status ?? "ACTIVE") === "ACTIVE")) {
      store.notifications.unshift({ id: newId("ntf", `${Date.now()}-${admin.id}`), userId: admin.id, title: "Web365 support asks for access", body: `${actor.name} asks for read-only access for ${minutes} minutes: ${reason.trim()}`, severity: "warning", link: "/support-access", createdAt: at });
    }
    recordAudit(supportIdentity(actor.id, actor.name), { action: "support.requested", entity: "SupportAccess", entityId: id, summary: `Web365 (${actor.name}) asked for ${minutes} minutes of read-only access: ${reason.trim()}`, severity: "warning" });
  }));
  await recordPlatformAudit(platformActorRef(actor), { action: "support.request", targetType: "SupportAccess", targetId: id, tenantId, summary: `Asked ${tenant.name} for ${minutes} minutes of read-only access: ${reason.trim()}` });
  return { id, status: "PENDING" };
}

/** Opens an approved grant: sets a read-only pharmacy session cookie for the requester. */
export async function openSupportSession(actor: PlatformActor, grantId: string, request: Request) {
  const [grant] = await platformQuery<GrantRow[]>((query) => query<GrantRow>(`${GRANT_SELECT} WHERE g.id = $1`, [grantId]));
  if (!grant) throw new DomainError("Support request not found.", 404);
  if (grant.requested_by !== actor.id) throw new DomainError("Only the person who asked for this access can use it.", 403);
  const status = effectiveGrantStatus(grant.status, grant.expires_at);
  if (status !== "APPROVED") throw new DomainError(status === "PENDING" ? "The pharmacy has not approved this request yet." : `This access is ${status.toLowerCase()}.`, 403);
  const [tenant] = await platformQuery<Array<{ status: string; name: string }>>((query) => query(`SELECT status, name FROM tenants WHERE id = $1`, [grant.tenant_id]));
  if (tenant?.status !== "ACTIVE") throw new DomainError("The pharmacy is not active.", 403);

  const identity = supportIdentity(actor.id, actor.name);
  const remaining = Math.max(60, Math.floor((new Date(grant.expires_at!).getTime() - Date.now()) / 1000));
  const token = await encode({
    token: { id: identity.id, name: identity.name, role: identity.role, tenantId: grant.tenant_id, outletId: null, supportGrantId: grant.id, signedInAt: Date.now() },
    secret: AUTH_SECRET,
    maxAge: remaining,
  });
  await runInTenant(grant.tenant_id, () => withDatabaseTransaction(() => {
    recordAudit(identity, { action: "support.session-started", entity: "SupportAccess", entityId: grant.id, summary: `${identity.name} opened a read-only support session (until ${new Date(grant.expires_at!).toISOString().slice(11, 16)} UTC)`, severity: "warning" });
  }));
  await recordPlatformAudit(platformActorRef(actor), { action: "support.open", targetType: "SupportAccess", targetId: grant.id, tenantId: grant.tenant_id, summary: `Opened a read-only support session in ${tenant.name}` });

  const secure = (process.env.NEXTAUTH_URL ?? new URL(request.url).origin).startsWith("https://");
  const response = NextResponse.json({ ok: true, url: "/dashboard" });
  response.cookies.set(secure ? "__Secure-next-auth.session-token" : "next-auth.session-token", token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: remaining });
  return response;
}

// ---------------------------------------------------------------- shared checks

/** The grant behind a support session, if it is still approved and unexpired for that pharmacy. */
export async function activeSupportGrant(grantId: string, tenantId: string | undefined) {
  if (!tenantId) return null;
  const [grant] = await platformQuery<GrantRow[]>((query) => query<GrantRow>(`${GRANT_SELECT} WHERE g.id = $1 AND g.tenant_id = $2`, [grantId, tenantId]));
  if (!grant || effectiveGrantStatus(grant.status, grant.expires_at) !== "APPROVED") return null;
  const [agent] = await platformQuery<Array<{ status: string }>>((query) => query(`SELECT status FROM platform_users WHERE id = $1`, [grant.requested_by]));
  if (agent?.status !== "ACTIVE") return null;
  return { id: grant.id, expiresAt: new Date(grant.expires_at!).toISOString(), agent: grant.requester_name };
}

/** The read-only actor for a support session (inside the pharmacy's transaction). */
export function supportActor(user: { id: string; name?: string | null }, tenantId: string, grantId: string): Actor {
  const open = outlets.filter((outlet) => outlet.status !== "CLOSED").map((outlet) => outlet.id);
  return { id: user.id, name: user.name ?? "Web365 Support", role: "PHARMACY_MANAGER", outletId: null, outletIds: open, permissions: [...SUPPORT_PERMISSIONS], tenantId, support: { grantId } };
}

// ---------------------------------------------------------------- pharmacy side (inside its transaction)

export async function grantsForPharmacy() {
  const tenantId = currentTenant()?.id;
  if (!tenantId) return [];
  const rows = await platformQuery<GrantRow[]>((query) => query<GrantRow>(`${GRANT_SELECT} WHERE g.tenant_id = $1 ORDER BY g.requested_at DESC LIMIT 50`, [tenantId]));
  return rows.map((grant) => ({
    id: grant.id, status: effectiveGrantStatus(grant.status, grant.expires_at), reason: grant.reason, minutes: grant.duration_minutes, requester: grant.requester_name,
    requestedAt: new Date(grant.requested_at).toISOString(), expiresAt: grant.expires_at ? new Date(grant.expires_at).toISOString() : null,
  }));
}

export async function decideSupportGrant(actor: Actor, grantId: string, decision: "APPROVED" | "DENIED" | "REVOKED") {
  if (actor.support) throw new DomainError("Support sessions cannot change support access.", 403);
  const tenant = currentTenant();
  if (!tenant) throw new DomainError("No pharmacy selected.", 401);
  const [grant] = await platformQuery<GrantRow[]>((query) => query<GrantRow>(`${GRANT_SELECT} WHERE g.id = $1 AND g.tenant_id = $2`, [grantId, tenant.id]));
  if (!grant) throw new DomainError("Support request not found.", 404);
  const status = effectiveGrantStatus(grant.status, grant.expires_at);
  const allowed = decision === "REVOKED" ? status === "APPROVED" : status === "PENDING";
  if (!allowed) throw new DomainError(`This request is ${status.toLowerCase()}; it cannot be ${decision.toLowerCase()} now.`);
  const expires = decision === "APPROVED" ? new Date(Date.now() + grant.duration_minutes * 60_000) : null;
  await platformQuery((query) =>
    query(
      decision === "REVOKED"
        ? `UPDATE support_access_grants SET status = 'REVOKED', decided_by = $2, decided_at = now() WHERE id = $1`
        : `UPDATE support_access_grants SET status = $3, decided_by = $2, decided_at = now(), expires_at = $4 WHERE id = $1`,
      decision === "REVOKED" ? [grantId, actor.id] : [grantId, actor.id, decision, expires],
    ),
  );
  const verb = { APPROVED: "approved", DENIED: "denied", REVOKED: "revoked" }[decision];
  const detail = decision === "APPROVED" ? ` for ${grant.duration_minutes} minutes (until ${expires!.toISOString().slice(11, 16)} UTC)` : "";
  recordAudit(actor, { action: `support.${verb}`, entity: "SupportAccess", entityId: grantId, summary: `${actor.name} ${verb} Web365 support access for ${grant.requester_name}${detail}`, severity: "warning" });
  await recordPlatformAudit({ id: actor.id, name: `${actor.name} (${tenant.name})`, type: "pharmacy" }, { action: `support.${verb}`, targetType: "SupportAccess", targetId: grantId, tenantId: tenant.id, summary: `${tenant.name} ${verb} support access for ${grant.requester_name}${detail}` });
  return { id: grantId, status: decision, expiresAt: expires?.toISOString() ?? null };
}
