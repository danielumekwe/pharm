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

export const planCreateSchema = z.object({
  id: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,39}$/, "Use 2 to 40 lowercase letters, digits or dashes, starting with a letter."),
  plan: planUpdateSchema,
});

/** A new plan. Its id is permanent (subscriptions and invoices refer to it); everything else can change. */
export async function createPlan(actor: PlatformActor, input: z.infer<typeof planCreateSchema>) {
  const { id, plan } = input;
  const inserted = await platformQuery<Array<{ id: string }>>((query) =>
    query(
      `INSERT INTO plans (id, name, description, monthly_price, annual_price, currency, trial_days, max_outlets, max_staff_accounts, features, is_active, is_public, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, plan.name, plan.description, plan.monthlyPrice, plan.annualPrice, plan.currency, plan.trialDays, plan.maxOutlets, plan.maxStaffAccounts, plan.features === null ? null : JSON.stringify(plan.features), plan.isActive, plan.isPublic, plan.sortOrder],
    ),
  );
  if (!inserted.length) throw new DomainError(`A plan with the id "${id}" already exists.`, 409);
  await recordPlatformAudit(platformActorRef(actor), {
    action: "plan.create", targetType: "Plan", targetId: id,
    summary: `Created plan ${plan.name} (${id}): monthly ${plan.monthlyPrice ?? "unset"} ${plan.currency}, annual ${plan.annualPrice ?? "unset"} ${plan.currency}, ${plan.maxOutlets ?? "unlimited"} outlets, ${plan.maxStaffAccounts ?? "unlimited"} staff accounts, ${plan.isPublic ? "public" : "hidden"}${plan.isActive ? "" : ", inactive"}`,
  });
  return { ok: true, id };
}
