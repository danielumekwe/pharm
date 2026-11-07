// Platform view of pharmacies: their account, subscription and usage counts, never their business records.
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import { platformQuery, type PlatformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { appUrl, notifyPharmacyOwners, sendAccountSetupEmail } from "@/lib/saas/account-email";
import { registerPharmacy, registrationFields, registrationSchema, validState } from "@/lib/saas/registration";

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  statusReason: string | null;
  isDemo: boolean;
  createdAt: string;
  planId: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  billingCycle: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  members: number;
  outlets: number;
  owner: { name: string; email: string } | null;
  deletionRequested: boolean;
};

export type TenantFilters = { q?: string; status?: string; subscription?: string; plan?: string; deletion?: boolean };

type Row = {
  id: string; name: string; slug: string; status: string; status_reason: string | null; is_demo: boolean; created_at: Date;
  plan_id: string | null; plan_name: string | null; sub_status: string | null; billing_cycle: string | null; trial_ends_at: Date | null; current_period_end: Date | null; members: string; owner_name: string | null; owner_email: string | null;
  deletion_requested: boolean;
};

const SELECT = `
  SELECT t.id, t.name, t.slug, t.status, t.status_reason, t.is_demo, t.created_at,
         p.id AS plan_id, p.name AS plan_name, s.status AS sub_status, s.billing_cycle, s.trial_ends_at, s.current_period_end,
         (SELECT count(*) FROM tenant_memberships m WHERE m.tenant_id = t.id AND m.status <> 'DEACTIVATED') AS members,
         o.name AS owner_name, o.email AS owner_email,
         EXISTS (SELECT 1 FROM tenant_deletion_requests d WHERE d.tenant_id = t.id AND d.status = 'REQUESTED') AS deletion_requested
  FROM tenants t
  LEFT JOIN subscriptions s ON s.tenant_id = t.id
  LEFT JOIN plans p ON p.id = s.plan_id
  LEFT JOIN LATERAL (
    SELECT u.name, u.email FROM tenant_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = t.id AND m.role = 'SUPER_ADMIN' ORDER BY m.created_at LIMIT 1
  ) o ON true`;

function summary(row: Row, outlets: number): TenantSummary {
  return {
    id: row.id, name: row.name, slug: row.slug, status: row.status, statusReason: row.status_reason, isDemo: row.is_demo,
    createdAt: new Date(row.created_at).toISOString(), planId: row.plan_id, plan: row.plan_name, subscriptionStatus: row.sub_status, billingCycle: row.billing_cycle,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
    members: Number(row.members), outlets,
    owner: row.owner_email ? { name: row.owner_name ?? "", email: row.owner_email } : null,
    deletionRequested: row.deletion_requested,
  };
}

/** A LIKE pattern matching the text anywhere, with the LIKE wildcards in it taken literally. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/** Outlet count, read in the pharmacy's own RLS scope (a count only). */
async function outletCount(query: PlatformQuery, tenantId: string) {
  const [row] = await query<{ n: string }>(`SELECT count(*) AS n FROM outlets WHERE tenant_id = $1`, [tenantId], tenantId);
  return Number(row?.n ?? 0);
}

/**
 * Pharmacies, newest first. q matches the name, slug, business email or any member's email; the other
 * filters match the pharmacy status, subscription status and plan exactly.
 */
export async function listTenants(filters: TenantFilters = {}): Promise<TenantSummary[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    params.push(contains(q));
    const n = `$${params.length}`;
    where.push(`(lower(t.name) LIKE ${n} OR t.slug LIKE ${n} OR lower(coalesce(t.business_email, '')) LIKE ${n}
      OR EXISTS (SELECT 1 FROM tenant_memberships qm JOIN users qu ON qu.id = qm.user_id WHERE qm.tenant_id = t.id AND lower(qu.email) LIKE ${n}))`);
  }
  for (const [column, value] of [["t.status", filters.status], ["s.status", filters.subscription], ["s.plan_id", filters.plan]] as const) {
    if (!value) continue;
    params.push(value);
    where.push(`${column} = $${params.length}`);
  }
  if (filters.deletion) where.push(`EXISTS (SELECT 1 FROM tenant_deletion_requests d WHERE d.tenant_id = t.id AND d.status = 'REQUESTED')`);
  return platformQuery(async (query) => {
    const rows = await query<Row>(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.created_at DESC LIMIT 500`, params);
    const result: TenantSummary[] = [];
    for (const row of rows) result.push(summary(row, await outletCount(query, row.id)));
    return result;
  });
}

export async function tenantDetail(tenantId: string) {
  return platformQuery(async (query) => {
    const [row] = await query<Row>(`${SELECT} WHERE t.id = $1`, [tenantId]);
    if (!row) throw new DomainError("Pharmacy not found.", 404);
    const audit = await query<{ at: Date; actor_name: string; action: string; summary: string; severity: string }>(
      `SELECT at, actor_name, action, summary, severity FROM platform_audit_events WHERE tenant_id = $1 ORDER BY at DESC LIMIT 50`,
      [tenantId],
    );
    const grants = await query<{ id: string; status: string; reason: string; duration_minutes: number; requested_at: Date; expires_at: Date | null; requester: string }>(
      `SELECT g.id, g.status, g.reason, g.duration_minutes, g.requested_at, g.expires_at, p.name AS requester
       FROM support_access_grants g JOIN platform_users p ON p.id = g.requested_by WHERE g.tenant_id = $1 ORDER BY g.requested_at DESC LIMIT 20`,
      [tenantId],
    );
    return {
      tenant: summary(row, await outletCount(query, tenantId)),
      audit: audit.map((entry) => ({ ...entry, at: new Date(entry.at).toISOString() })),
      grants: grants.map((grant) => ({
        id: grant.id, status: effectiveGrantStatus(grant.status, grant.expires_at), reason: grant.reason, minutes: grant.duration_minutes, requester: grant.requester,
        requestedAt: new Date(grant.requested_at).toISOString(), expiresAt: grant.expires_at ? new Date(grant.expires_at).toISOString() : null,
      })),
    };
  });
}

export function effectiveGrantStatus(status: string, expiresAt: Date | string | null) {
  return status === "APPROVED" && expiresAt && new Date(expiresAt).getTime() <= Date.now() ? "EXPIRED" : status;
}

export async function setTenantStatus(actor: PlatformActor, tenantId: string, status: "ACTIVE" | "SUSPENDED", reason: string) {
  if (status === "SUSPENDED" && reason.trim().length < 5) throw new DomainError("Give a reason for suspending the pharmacy (it is shown to its users).");
  const [row] = await platformQuery<Array<{ name: string; status: string; is_demo: boolean }>>((query) => query(`SELECT name, status, is_demo FROM tenants WHERE id = $1`, [tenantId]));
  if (!row) throw new DomainError("Pharmacy not found.", 404);
  if (row.status === status) throw new DomainError(`The pharmacy is already ${status.toLowerCase()}.`);
  await platformQuery((query) =>
    query(`UPDATE tenants SET status = $1, status_reason = $2, status_changed_at = now(), updated_at = now() WHERE id = $3`, [status, status === "SUSPENDED" ? reason.trim() : null, tenantId]),
  );
  await recordPlatformAudit(platformActorRef(actor), {
    action: status === "SUSPENDED" ? "tenant.suspend" : "tenant.reactivate",
    targetType: "Tenant", targetId: tenantId, tenantId, severity: status === "SUSPENDED" ? "warning" : "info",
    summary: status === "SUSPENDED" ? `Suspended ${row.name}: ${reason.trim()}` : `Reactivated ${row.name}`,
  });
  const notice = status === "SUSPENDED"
    ? notifyPharmacyOwners(tenantId, "account_suspended", { reason: reason.trim() }, "platform")
    : notifyPharmacyOwners(tenantId, "account_reactivated", { link: `${appUrl()}/` }, "platform");
  await notice.catch((error) => console.error("[platform] status email failed", error instanceof Error ? error.message : "error"));
  return { ok: true };
}

/** Web365 creates a pharmacy for a customer; the owner receives a link to choose their password. */
export const platformCreateSchema = registrationFields
  .omit({ requestId: true, password: true })
  .extend({ requestId: z.string().uuid().optional() })
  .refine(validState, { path: ["state"], message: "Choose a Nigerian state." });

export async function createTenantForCustomer(actor: PlatformActor, input: z.infer<typeof platformCreateSchema>) {
  const password = `Wx${randomBytes(18).toString("base64url")}9`; // never shown; the owner sets their own
  const parsed = registrationSchema.parse({ ...input, requestId: input.requestId ?? randomUUID(), password });
  const result = await registerPharmacy(parsed);
  if (!result.created) throw new DomainError("This form was already submitted.", 409);
  const [owner] = await platformQuery<Array<{ id: string; name: string; email: string }>>((query) => query(`SELECT id, name, email FROM users WHERE email = $1`, [parsed.ownerEmail]));
  const delivery = owner ? await sendAccountSetupEmail(owner, parsed.businessName) : { status: "FAILED" as const };
  await recordPlatformAudit(platformActorRef(actor), { action: "tenant.create", targetType: "Tenant", targetId: result.tenantId, tenantId: result.tenantId, summary: `Created ${parsed.businessName} for ${parsed.ownerName} <${parsed.ownerEmail}> on the ${parsed.planId} plan (setup email ${delivery.status.toLowerCase()})` });
  return { tenantId: result.tenantId, setupEmail: delivery.status };
}
