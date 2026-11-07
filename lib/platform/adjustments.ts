// Manual subscription changes by Web365 staff. Each one needs a reason and is written to the append-only
// subscription_adjustments ledger (values before and after) as well as the platform audit log.
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";

export const adjustmentReason = z.string().trim().min(5, "Give a reason (at least 5 characters).").max(300);

export type SubscriptionState = { planId: string; plan: string; billingCycle: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null };

export async function subscriptionState(tenantId: string): Promise<(SubscriptionState & { id: string; tenantName: string }) | null> {
  const [row] = await platformQuery<Array<{ id: string; plan_id: string; plan_name: string; billing_cycle: string; status: string; trial_ends_at: Date | null; current_period_end: Date | null; tenant_name: string }>>((query) =>
    query(
      `SELECT s.id, s.plan_id, p.name AS plan_name, s.billing_cycle, s.status, s.trial_ends_at, s.current_period_end, t.name AS tenant_name
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1`,
      [tenantId],
    ),
  );
  if (!row) return null;
  const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);
  return { id: row.id, tenantName: row.tenant_name, planId: row.plan_id, plan: row.plan_name, billingCycle: row.billing_cycle, status: row.status, trialEndsAt: iso(row.trial_ends_at), currentPeriodEnd: iso(row.current_period_end) };
}

const strip = ({ planId, plan, billingCycle, status, trialEndsAt, currentPeriodEnd }: SubscriptionState) => ({ planId, plan, billingCycle, status, trialEndsAt, currentPeriodEnd });

/**
 * Runs one manual change and records it. `change` gets the current state and makes the update; the ledger
 * row stores the state before and after, so every adjustment can be reviewed (and undone by hand).
 */
export async function adjustSubscription(
  actor: PlatformActor,
  tenantId: string,
  kind: string,
  reason: string,
  change: (current: SubscriptionState & { id: string; tenantName: string }) => Promise<string>,
  severity: "info" | "warning" = "info",
) {
  const why = adjustmentReason.safeParse(reason);
  if (!why.success) throw new DomainError(why.error.issues[0]?.message ?? "Give a reason.", 400);
  const before = await subscriptionState(tenantId);
  if (!before) throw new DomainError("Pharmacy or subscription not found.", 404);
  const description = await change(before);
  const after = await subscriptionState(tenantId);
  await platformQuery((query) =>
    query(
      `INSERT INTO subscription_adjustments (id, tenant_id, actor_id, actor_name, kind, before, after, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`adj-${randomUUID()}`, tenantId, actor.id, actor.name, kind, JSON.stringify(strip(before)), JSON.stringify(after ? strip(after) : null), why.data],
    ),
  );
  await recordPlatformAudit(platformActorRef(actor), { action: `subscription.${kind}`, targetType: "Subscription", targetId: before.id, tenantId, severity, summary: `${description}. Reason: ${why.data}` });
  return { ok: true, subscription: after };
}

export async function adjustmentHistory(tenantId: string) {
  const rows = await platformQuery<Array<{ at: Date; actor_name: string; kind: string; before: SubscriptionState; after: SubscriptionState | null; reason: string }>>((query) =>
    query(`SELECT at, actor_name, kind, before, after, reason FROM subscription_adjustments WHERE tenant_id = $1 ORDER BY at DESC LIMIT 50`, [tenantId]),
  );
  return rows.map((row) => ({ ...row, at: new Date(row.at).toISOString() }));
}

const DAY = 86_400_000;
const day = (value: Date) => value.toISOString().slice(0, 10);

export async function extendTrial(actor: PlatformActor, tenantId: string, days: number, reason: string) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new DomainError("Extend by 1 to 90 days.");
  return adjustSubscription(actor, tenantId, "extend-trial", reason, async (current) => {
    if (!["TRIAL", "EXPIRED"].includes(current.status)) throw new DomainError("Only a trial (or an expired trial) can be extended.");
    const ends = new Date(Math.max(Date.now(), current.trialEndsAt ? Date.parse(current.trialEndsAt) : 0) + days * DAY);
    await platformQuery((query) => query(`UPDATE subscriptions SET status = 'TRIAL', trial_ends_at = $1, updated_at = now() WHERE tenant_id = $2`, [ends, tenantId]));
    return `Extended ${current.tenantName}'s trial by ${days} days, to ${day(ends)}`;
  });
}

/** Complimentary time on a paid subscription (e.g. after an outage); it becomes active to the new date. */
export async function extendPaidPeriod(actor: PlatformActor, tenantId: string, days: number, reason: string) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new DomainError("Extend by 1 to 366 days.");
  return adjustSubscription(actor, tenantId, "extend-period", reason, async (current) => {
    if (!["ACTIVE", "GRACE", "PAST_DUE"].includes(current.status)) throw new DomainError("Only a paid subscription (active, in grace or past due) can be extended. Use the trial extension for trials.");
    const ends = new Date(Math.max(Date.now(), current.currentPeriodEnd ? Date.parse(current.currentPeriodEnd) : 0) + days * DAY);
    await platformQuery((query) => query(`UPDATE subscriptions SET status = 'ACTIVE', current_period_end = $1, updated_at = now() WHERE tenant_id = $2`, [ends, tenantId]));
    return `Added ${days} days to ${current.tenantName}'s paid period, to ${day(ends)}`;
  });
}

export async function changeTenantPlan(actor: PlatformActor, tenantId: string, planId: string, billingCycle: "MONTHLY" | "ANNUAL", reason: string) {
  const [plan] = await platformQuery<Array<{ name: string }>>((query) => query(`SELECT name FROM plans WHERE id = $1 AND is_active`, [planId]));
  if (!plan) throw new DomainError("Choose an active plan.", 400);
  return adjustSubscription(actor, tenantId, "change-plan", reason, async (current) => {
    if (current.planId === planId && current.billingCycle === billingCycle) throw new DomainError("The pharmacy is already on that plan and cycle.");
    await platformQuery((query) => query(`UPDATE subscriptions SET plan_id = $1, billing_cycle = $2, updated_at = now() WHERE tenant_id = $3`, [planId, billingCycle, tenantId]));
    return `Changed ${current.tenantName}'s plan from ${current.plan} (${current.billingCycle.toLowerCase()}) to ${plan.name} (${billingCycle.toLowerCase()})`;
  });
}

export type ManualStatus = "ACTIVE" | "PAST_DUE" | "GRACE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";

export async function setTenantSubscriptionStatus(actor: PlatformActor, tenantId: string, status: ManualStatus, currentPeriodEnd: string | null, reason: string) {
  const periodEnd = currentPeriodEnd ? new Date(`${currentPeriodEnd}T23:59:59.999Z`) : null;
  if (currentPeriodEnd && Number.isNaN(periodEnd?.getTime())) throw new DomainError("Choose a valid period end date.");
  if (status === "GRACE" && (!periodEnd || periodEnd.getTime() <= Date.now())) throw new DomainError("Set a future grace-period end date.");
  if (status === "ACTIVE" && periodEnd && periodEnd.getTime() <= Date.now()) throw new DomainError("An active subscription needs a future period end date (or none).");
  return adjustSubscription(actor, tenantId, "status", reason, async (current) => {
    if (current.status === status && (current.currentPeriodEnd ? Date.parse(current.currentPeriodEnd) : 0) === (periodEnd?.getTime() ?? 0)) throw new DomainError(`Subscription is already ${status.toLowerCase()}.`);
    await platformQuery((query) => query(`UPDATE subscriptions SET status = $1, current_period_end = $2, updated_at = now() WHERE tenant_id = $3`, [status, periodEnd, tenantId]));
    return `Changed ${current.tenantName}'s subscription ${current.status} → ${status}${periodEnd ? ` (to ${day(periodEnd)})` : ""}`;
  }, ["PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(status) ? "warning" : "info");
}
