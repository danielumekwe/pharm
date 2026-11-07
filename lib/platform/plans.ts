// Web365's plan catalogue: pricing, quotas and optional feature allowlists.
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";

const featureKey = z.enum(["stock_transfers", "regulatory_management"]);
const price = z.number().finite().min(0).max(99_999_999_999_999).refine(
  (value) => Math.abs(value * 10_000 - Math.round(value * 10_000)) < 0.000001,
  "Enter at most four decimal places.",
);

export const planUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(600),
  monthlyPrice: price.nullable(),
  annualPrice: price.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  trialDays: z.number().int().min(0).max(365),
  maxOutlets: z.number().int().min(1).nullable(),
  maxStaffAccounts: z.number().int().min(1).nullable(),
  features: z.array(featureKey).max(64).nullable(),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
}).refine((value) => value.features === null || new Set(value.features).size === value.features.length, {
  path: ["features"],
  message: "Feature keys must be unique.",
});

export type PlanConfiguration = {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  currency: string;
  trialDays: number;
  maxOutlets: number | null;
  maxStaffAccounts: number | null;
  features: string[] | null;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
};

type PlanRow = {
  id: string;
  name: string;
  description: string;
  monthly_price: string | null;
  annual_price: string | null;
  currency: string;
  trial_days: number;
  max_outlets: number | null;
  max_staff_accounts: number | null;
  features: unknown;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
};

function normalizeFeatures(features: unknown): string[] | null {
  if (!Array.isArray(features)) return null;
  return features.filter((feature): feature is string => typeof feature === "string");
}

function toPlan(row: PlanRow): PlanConfiguration {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    monthlyPrice: row.monthly_price === null ? null : Number(row.monthly_price),
    annualPrice: row.annual_price === null ? null : Number(row.annual_price),
    currency: row.currency,
    trialDays: row.trial_days,
    maxOutlets: row.max_outlets,
    maxStaffAccounts: row.max_staff_accounts,
    features: normalizeFeatures(row.features),
    isActive: row.is_active,
    isPublic: row.is_public,
    sortOrder: row.sort_order,
  };
}

const PLAN_COLUMNS = `id, name, description, monthly_price, annual_price, currency, trial_days,
                      max_outlets, max_staff_accounts, features, is_active, is_public, sort_order`;

export async function listPlanConfigurations(): Promise<PlanConfiguration[]> {
  const rows = await platformQuery<PlanRow[]>((query) => query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans ORDER BY sort_order, name`));
  return rows.map(toPlan);
}

export async function updatePlanConfiguration(actor: PlatformActor, planId: string, input: z.infer<typeof planUpdateSchema>) {
  const [existing] = await platformQuery<PlanRow[]>((query) =>
    query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [planId]),
  );
  if (!existing) throw new DomainError("Plan not found.", 404);
  const features = input.features === null ? null : JSON.stringify(input.features);
  await platformQuery((query) =>
    query(
      `UPDATE plans
       SET name = $1, description = $2, monthly_price = $3, annual_price = $4, currency = $5, trial_days = $6,
           max_outlets = $7, max_staff_accounts = $8, features = $9::jsonb, is_active = $10, is_public = $11,
           sort_order = $12, updated_at = now()
       WHERE id = $13`,
      [
        input.name, input.description, input.monthlyPrice, input.annualPrice, input.currency, input.trialDays,
        input.maxOutlets, input.maxStaffAccounts, features, input.isActive, input.isPublic, input.sortOrder, planId,
      ],
    ),
  );
  await recordPlatformAudit(platformActorRef(actor), {
    action: "plan.update",
    targetType: "Plan",
    targetId: planId,
    summary: `Updated ${input.name}: monthly ${input.monthlyPrice ?? "unset"} ${input.currency}, annual ${input.annualPrice ?? "unset"} ${input.currency}, ${input.maxOutlets ?? "unset"} outlets, ${input.maxStaffAccounts ?? "unset"} staff accounts, features ${features === null ? "unconfigured" : input.features?.join(", ") || "none"}`,
  });
  return { ok: true };
}

export async function activePlansForAssignment() {
  const rows = await platformQuery<Array<{ id: string; name: string }>>((query) =>
    query(`SELECT id, name FROM plans WHERE is_active ORDER BY sort_order, name`),
  );
  return rows;
}

export async function changeTenantPlan(actor: PlatformActor, tenantId: string, planId: string, billingCycle: "MONTHLY" | "ANNUAL") {
  const [plan] = await platformQuery<Array<{ name: string }>>((query) =>
    query(`SELECT name FROM plans WHERE id = $1 AND is_active`, [planId]),
  );
  if (!plan) throw new DomainError("Choose an active plan.", 400);
  const [subscription] = await platformQuery<Array<{ id: string; plan_name: string; tenant_name: string }>>((query) =>
    query(
      `SELECT s.id, p.name AS plan_name, t.name AS tenant_name
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id
       WHERE s.tenant_id = $1`,
      [tenantId],
    ),
  );
  if (!subscription) throw new DomainError("Pharmacy or subscription not found.", 404);
  await platformQuery((query) =>
    query(`UPDATE subscriptions SET plan_id = $1, billing_cycle = $2, updated_at = now() WHERE tenant_id = $3`, [planId, billingCycle, tenantId]),
  );
  await recordPlatformAudit(platformActorRef(actor), {
    action: "subscription.change-plan",
    targetType: "Subscription",
    targetId: subscription.id,
    tenantId,
    summary: `Changed ${subscription.tenant_name}'s plan from ${subscription.plan_name} to ${plan.name} (${billingCycle.toLowerCase()})`,
  });
  return { ok: true };
}

export async function setTenantSubscriptionStatus(
  actor: PlatformActor,
  tenantId: string,
  status: "ACTIVE" | "PAST_DUE" | "GRACE" | "SUSPENDED" | "CANCELLED" | "EXPIRED",
  currentPeriodEnd: string | null,
) {
  const periodEnd = currentPeriodEnd ? new Date(`${currentPeriodEnd}T23:59:59.999Z`) : null;
  if (currentPeriodEnd && Number.isNaN(periodEnd?.getTime())) throw new DomainError("Choose a valid period end date.");
  if (status === "GRACE" && (!periodEnd || periodEnd.getTime() <= Date.now())) {
    throw new DomainError("Set a future grace-period end date.");
  }
  const [subscription] = await platformQuery<Array<{ id: string; status: string; tenant_name: string; current_period_end: Date | null }>>((query) =>
    query(
      `SELECT s.id, s.status, s.current_period_end, t.name AS tenant_name FROM subscriptions s
       JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1`,
      [tenantId],
    ),
  );
  if (!subscription) throw new DomainError("Pharmacy subscription not found.", 404);
  if (subscription.status === status && (subscription.current_period_end?.getTime() ?? 0) === (periodEnd?.getTime() ?? 0)) {
    throw new DomainError(`Subscription is already ${status.toLowerCase()}.`);
  }
  await platformQuery((query) =>
    query(`UPDATE subscriptions SET status = $1, current_period_end = $2, updated_at = now() WHERE tenant_id = $3`, [status, periodEnd, tenantId]),
  );
  await recordPlatformAudit(platformActorRef(actor), {
    action: "subscription.status",
    targetType: "Subscription",
    targetId: subscription.id,
    tenantId,
    severity: ["PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(status) ? "warning" : "info",
    summary: `Changed ${subscription.tenant_name}'s subscription ${subscription.status} → ${status}`,
  });
  return { ok: true };
}
