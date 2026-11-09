// Web365's administration of one pharmacy: its business details, who works there, its outlets, how active it
// is, and account closure requests. Business records (sales, stock, patients) are never read here: activity
// is shown as counts only.
import { randomUUID } from "node:crypto";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { verifyPassword } from "@/lib/password";
import { adjustSubscription } from "@/lib/platform/adjustments";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { readPlatformSetting } from "@/lib/platform/settings";
import { sendEmail } from "@/lib/notify/email";
import { renderEmail } from "@/lib/notify/templates";
import { appUrl, notifyPharmacyOwners } from "@/lib/saas/account-email";
import { tenantProfileSchema, type TenantProfile } from "@/lib/saas/onboarding";

type ProfileRow = { name: string; business_email: string | null; business_phone: string | null; address: string | null; country: string; state: string | null; currency: string; time_zone: string };

export async function tenantProfile(tenantId: string): Promise<TenantProfile> {
  const [row] = await platformQuery<ProfileRow[]>((query) => query(`SELECT name, business_email, business_phone, address, country, state, currency, time_zone FROM tenants WHERE id = $1`, [tenantId]));
  if (!row) throw new DomainError("Pharmacy not found.", 404);
  return { businessName: row.name, businessEmail: row.business_email ?? "", businessPhone: row.business_phone ?? "", address: row.address ?? "", country: row.country as TenantProfile["country"], state: row.state ?? "", currency: row.currency as TenantProfile["currency"], timeZone: row.time_zone };
}

const PROFILE_LABELS: Record<keyof TenantProfile, string> = { businessName: "name", businessEmail: "email", businessPhone: "phone", address: "address", country: "country", state: "state", currency: "currency", timeZone: "time zone" };

/** Corrects a pharmacy's business details (the same fields its Super Admin edits in its own settings). */
export async function updateTenantProfile(actor: PlatformActor, tenantId: string, input: unknown) {
  const parsed = tenantProfileSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(`Check ${parsed.error.issues[0]?.path.join(".") || "the form"}: ${parsed.error.issues[0]?.message ?? "invalid value"}.`, 422);
  const before = await tenantProfile(tenantId);
  const next = parsed.data;
  const changes = (Object.keys(PROFILE_LABELS) as Array<keyof TenantProfile>).filter((key) => before[key] !== next[key]).map((key) => `${PROFILE_LABELS[key]}: ${JSON.stringify(before[key])} → ${JSON.stringify(next[key])}`);
  if (!changes.length) return { ok: true, profile: before };
  await platformQuery(async (query) => {
    await query(
      `UPDATE tenants SET name = $1, business_email = $2, business_phone = $3, address = $4, country = $5, state = $6, currency = $7, time_zone = $8, updated_at = now() WHERE id = $9`,
      [next.businessName, next.businessEmail, next.businessPhone, next.address, next.country, next.state, next.currency, next.timeZone, tenantId],
    );
    // The name shown inside the pharmacy's own app follows the account name.
    if (next.businessName !== before.businessName) {
      await query(`UPDATE app_state SET value = jsonb_set(value::jsonb, '{businessName}', to_jsonb($1::text))::text WHERE tenant_id = $2 AND key = 'settings'`, [next.businessName, tenantId], tenantId);
    }
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "tenant.update-profile", targetType: "Tenant", targetId: tenantId, tenantId, summary: `Updated ${next.businessName}'s details: ${changes.join("; ")}` });
  return { ok: true, profile: next };
}

/** Everyone with an account at the pharmacy: name, email, role and status (no business data). */
export async function tenantPeople(tenantId: string) {
  const rows = await platformQuery<Array<{ user_id: string; name: string; email: string; role: string; status: string; last_login: string | null; email_verified_at: string | null; joined_at: Date }>>((query) =>
    query(
      `SELECT u.id AS user_id, u.name, u.email, m.role, m.status, u.last_login, u.email_verified_at, m.created_at AS joined_at
       FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1
       ORDER BY CASE m.role WHEN 'SUPER_ADMIN' THEN 0 ELSE 1 END, m.status, u.name`,
      [tenantId],
    ),
  );
  return rows.map((row) => ({ ...row, joined_at: new Date(row.joined_at).toISOString() }));
}

/** The pharmacy's outlets (read in its own scope). */
export async function tenantOutlets(tenantId: string) {
  return platformQuery<Array<{ id: string; name: string; code: string; type: string | null; status: string | null; address: string | null }>>((query) =>
    query(`SELECT id, name, code, type, status, address FROM outlets WHERE tenant_id = $1 ORDER BY seq`, [tenantId], tenantId),
  );
}

/** How much the pharmacy uses the system: counts of recorded actions by area, never their content. */
export async function tenantActivity(tenantId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return platformQuery(async (query) => {
    const [totals] = await query<{ last_at: string | null; actions_30d: string; sign_ins_30d: string; failed_sign_ins_30d: string }>(
      `SELECT max(at) AS last_at, count(*) FILTER (WHERE at >= $2) AS actions_30d,
              count(*) FILTER (WHERE at >= $2 AND action = 'auth.login') AS sign_ins_30d,
              count(*) FILTER (WHERE at >= $2 AND action = 'auth.failed') AS failed_sign_ins_30d
       FROM audit_events WHERE tenant_id = $1`,
      [tenantId, since], tenantId,
    );
    const areas = await query<{ area: string; count: string }>(
      `SELECT split_part(coalesce(action, 'other'), '.', 1) AS area, count(*) AS count FROM audit_events
       WHERE tenant_id = $1 AND at >= $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      [tenantId, since], tenantId,
    );
    return {
      lastActivityAt: totals?.last_at ?? null,
      actions30d: Number(totals?.actions_30d ?? 0),
      signIns30d: Number(totals?.sign_ins_30d ?? 0),
      failedSignIns30d: Number(totals?.failed_sign_ins_30d ?? 0),
      areas: areas.map((row) => ({ area: row.area, count: Number(row.count) })),
    };
  });
}

// ── Account closure ──────────────────────────────────────────────────────────────────────────────────────

type ClosureRow = { id: string; tenant_id: string; requested_by_name: string; requested_at: Date; reason: string; status: string; decided_by_name: string | null; decided_at: Date | null; decision_note: string | null; purge_after: Date | null };
const closureView = (row: ClosureRow) => ({
  id: row.id, requestedBy: row.requested_by_name, requestedAt: new Date(row.requested_at).toISOString(), reason: row.reason, status: row.status,
  decidedBy: row.decided_by_name, decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null, note: row.decision_note,
  purgeAfter: row.purge_after ? new Date(row.purge_after).toISOString() : null,
});

export async function closureRequests(tenantId: string) {
  const rows = await platformQuery<ClosureRow[]>((query) => query(`SELECT * FROM tenant_deletion_requests WHERE tenant_id = $1 ORDER BY requested_at DESC LIMIT 20`, [tenantId]));
  return rows.map(closureView);
}

/** Open closure requests across the platform (for the pharmacies list). */
export async function openClosureCount() {
  const [row] = await platformQuery<Array<{ n: string }>>((query) => query(`SELECT count(*) AS n FROM tenant_deletion_requests WHERE status = 'REQUESTED'`));
  return Number(row?.n ?? 0);
}

/**
 * Pharmacy side: the Super Admin asks Web365 to close the pharmacy, confirming with their password. Nothing
 * changes until Web365 approves; the request can be withdrawn until then.
 */
export async function requestClosure(actor: { id: string; name: string; role: string }, tenantId: string, input: { reason: string; password: string }) {
  if (actor.role !== "SUPER_ADMIN") throw new DomainError("Only the pharmacy's Super Admin can ask to close it.", 403);
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 600) throw new DomainError("Tell us why (5 to 600 characters).");
  const [user] = await platformQuery<Array<{ email: string; password: string | null; password_hash: string | null }>>((query) => query(`SELECT email, password, password_hash FROM users WHERE id = $1`, [actor.id]));
  if (!user || !((user.password && user.password === input.password) || verifyPassword(input.password, user.password_hash))) throw new DomainError("The password is not correct.", 403, true);
  const [tenant] = await platformQuery<Array<{ name: string; is_demo: boolean }>>((query) => query(`SELECT name, is_demo FROM tenants WHERE id = $1`, [tenantId]));
  if (!tenant) throw new DomainError("Pharmacy not found.", 404);
  if (tenant.is_demo) throw new DomainError("The demo pharmacy cannot be closed.");
  const [open] = await platformQuery<Array<{ id: string }>>((query) => query(`SELECT id FROM tenant_deletion_requests WHERE tenant_id = $1 AND status = 'REQUESTED'`, [tenantId]));
  if (open) throw new DomainError("A request to close this pharmacy is already waiting for Web365.", 409);
  const id = `close-${randomUUID()}`;
  try {
    await platformQuery((query) => query(`INSERT INTO tenant_deletion_requests (id, tenant_id, requested_by, requested_by_name, reason) VALUES ($1, $2, $3, $4, $5)`, [id, tenantId, actor.id, actor.name, reason]));
  } catch (error) {
    if (error instanceof Error && /tenant_deletion_requests_open_key|unique/i.test(error.message)) throw new DomainError("A request to close this pharmacy is already waiting for Web365.", 409);
    throw error;
  }
  await recordPlatformAudit({ id: actor.id, name: actor.name, type: "pharmacy" }, { action: "tenant.closure-requested", targetType: "Tenant", targetId: tenantId, tenantId, severity: "warning", summary: `${actor.name} asked to close ${tenant.name}: ${reason}` });
  const settings = await readPlatformSetting("email.delivery").catch(() => null);
  if (settings?.value.notifyEmail) {
    const email = await renderEmail("closure_requested", { pharmacy: tenant.name, owner_name: actor.name, owner_email: user.email, reason, link: `${appUrl()}/platform/tenants/${tenantId}` });
    await sendEmail({ to: settings.value.notifyEmail, ...email }, { category: "platform", template: "closure_requested", tenantId, retryable: true });
  }
  return { ok: true, request: (await closureRequests(tenantId))[0] };
}

export async function withdrawClosure(actor: { id: string; name: string; role: string }, tenantId: string) {
  if (actor.role !== "SUPER_ADMIN") throw new DomainError("Only the pharmacy's Super Admin can withdraw the request.", 403);
  const rows = await platformQuery<Array<{ id: string }>>((query) =>
    query(`UPDATE tenant_deletion_requests SET status = 'CANCELLED', decided_by = $1, decided_by_name = $2, decided_at = now() WHERE tenant_id = $3 AND status = 'REQUESTED' RETURNING id`, [actor.id, actor.name, tenantId]),
  );
  if (!rows.length) throw new DomainError("There is no open request to withdraw.", 404);
  await recordPlatformAudit({ id: actor.id, name: actor.name, type: "pharmacy" }, { action: "tenant.closure-withdrawn", targetType: "Tenant", targetId: tenantId, tenantId, summary: `${actor.name} withdrew the request to close the pharmacy` });
  return { ok: true };
}

/**
 * Web365 decides. Approving closes the pharmacy (no one can sign in), cancels its subscription and sets the
 * earliest purge date from the subscription policy. The data itself is not deleted here.
 */
export async function decideClosure(actor: PlatformActor, tenantId: string, requestId: string, decision: "approve" | "reject", note: string) {
  const text = note.trim();
  if (decision === "reject" && text.length < 5) throw new DomainError("Tell the pharmacy why (at least 5 characters).");
  const [request] = await platformQuery<Array<ClosureRow & { tenant_name: string; is_demo: boolean }>>((query) =>
    query(`SELECT d.*, t.name AS tenant_name, t.is_demo FROM tenant_deletion_requests d JOIN tenants t ON t.id = d.tenant_id WHERE d.id = $1 AND d.tenant_id = $2`, [requestId, tenantId]),
  );
  if (!request) throw new DomainError("Request not found.", 404);
  if (request.status !== "REQUESTED") throw new DomainError(`This request was already ${request.status.toLowerCase()}.`, 409);
  if (decision === "reject") {
    const done = await platformQuery<Array<{ id: string }>>((query) => query(`UPDATE tenant_deletion_requests SET status = 'REJECTED', decided_by = $1, decided_by_name = $2, decided_at = now(), decision_note = $3 WHERE id = $4 AND status = 'REQUESTED' RETURNING id`, [actor.id, actor.name, text, requestId]));
    if (!done.length) throw new DomainError("This request was already decided.", 409);
    await recordPlatformAudit(platformActorRef(actor), { action: "tenant.closure-rejected", targetType: "Tenant", targetId: tenantId, tenantId, summary: `Declined the request to close ${request.tenant_name}: ${text}` });
    await notifyPharmacyOwners(tenantId, "closure_declined", { note: text }, "platform").catch(() => undefined);
    return { ok: true };
  }
  if (request.is_demo) throw new DomainError("The demo pharmacy cannot be closed.");
  const policy = await readPlatformSetting("subscriptions.policy");
  const purgeAfter = new Date(Date.now() + policy.value.closedRetentionDays * 86_400_000);
  const reason = `Closed at the owner's request${text ? `: ${text}` : ""}`;
  // Owners are emailed before closing (afterwards the pharmacy has no active owners to find).
  const purgeDate = purgeAfter.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  // Claim the request first, so two people approving at once cannot both act.
  const claimed = await platformQuery<Array<{ id: string }>>((query) =>
    query(`UPDATE tenant_deletion_requests SET status = 'APPROVED', decided_by = $1, decided_by_name = $2, decided_at = now(), decision_note = $3, purge_after = $4 WHERE id = $5 AND status = 'REQUESTED' RETURNING id`, [actor.id, actor.name, text || null, purgeAfter, requestId]),
  );
  if (!claimed.length) throw new DomainError("This request was already decided.", 409);
  await notifyPharmacyOwners(tenantId, "account_closed", { purge_date: purgeDate }, "platform").catch(() => undefined);
  await adjustSubscription(actor, tenantId, "close", `Account closure request ${requestId} approved${text ? ` (${text})` : ""}`, async (current) => {
    await platformQuery(async (query) => {
      await query(`UPDATE subscriptions SET status = 'CANCELLED', cancel_at_period_end = false, scheduled_plan_id = NULL, scheduled_billing_cycle = NULL, updated_at = now() WHERE tenant_id = $1`, [tenantId]);
      await query(`UPDATE tenants SET status = 'CLOSED', status_reason = $1, status_changed_at = now(), purge_after = $2, updated_at = now() WHERE id = $3`, [reason, purgeAfter, tenantId]);
    });
    return `Closed ${current.tenantName} at the owner's request; data kept until ${purgeAfter.toISOString().slice(0, 10)}`;
  }, "warning");
  return { ok: true, purgeAfter: purgeAfter.toISOString() };
}

/** Pharmacy side: the latest closure request, for its settings page. */
export async function latestClosure(tenantId: string) {
  const [row] = await platformQuery<ClosureRow[]>((query) => query(`SELECT * FROM tenant_deletion_requests WHERE tenant_id = $1 ORDER BY requested_at DESC LIMIT 1`, [tenantId]));
  return row ? closureView(row) : null;
}

/** Read-only: this pharmacy's recent staff sign-in attempts (successful and failed), newest first. */
export async function tenantSignIns(tenantId: string, limit = 50) {
  const rows = await platformQuery<Array<{ at: Date; identifier: string; outcome: string; ip: string | null; detail: string | null }>>((query) =>
    query(`SELECT at, identifier, outcome, ip, detail FROM sign_in_attempts WHERE tenant_id = $1 AND surface = 'pharmacy' ORDER BY at DESC LIMIT $2`, [tenantId, limit]),
  );
  return rows.map((row) => ({ at: new Date(row.at).toISOString(), identifier: row.identifier, outcome: row.outcome, ip: row.ip, detail: row.detail }));
}
