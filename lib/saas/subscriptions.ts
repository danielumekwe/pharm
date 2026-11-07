// Per-tenant subscription state and plan entitlements.
import { currentTenant, platformQuery } from "@/lib/db/database";
import { outlets, users } from "@/lib/data";
import { DomainError } from "@/lib/erp/services";

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  plan_name: string;
  status: string;
  billing_cycle: string;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  max_outlets: number | null;
  max_staff_accounts: number | null;
  features: unknown;
  cancel_at_period_end: boolean;
  scheduled_plan_id: string | null;
  scheduled_plan_name: string | null;
  scheduled_billing_cycle: string | null;
  card_label: string | null;
  is_demo: boolean;
};

function featureList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((feature): feature is string => typeof feature === "string") : null;
}

export async function currentSubscription(): Promise<(SubscriptionRow & { features: string[] | null }) | null> {
  const tenantId = currentTenant()?.id;
  if (!tenantId) return null;
  const [row] = await platformQuery<SubscriptionRow[]>((query) =>
    query<SubscriptionRow>(
      `SELECT s.id, s.tenant_id, s.plan_id, p.name AS plan_name, s.status, s.billing_cycle,
              s.trial_ends_at, s.current_period_end, p.max_outlets, p.max_staff_accounts, p.features,
              s.cancel_at_period_end, s.scheduled_plan_id, sp.name AS scheduled_plan_name, s.scheduled_billing_cycle, s.card_label, t.is_demo
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id LEFT JOIN plans sp ON sp.id = s.scheduled_plan_id
       WHERE s.tenant_id = $1`,
      [tenantId],
    ),
  );
  return row ? { ...row, features: featureList(row.features) } : null;
}

function subscriptionProblem(subscription: Awaited<ReturnType<typeof currentSubscription>>) {
  if (!subscription) return "This pharmacy does not have a subscription. Contact Web365 to restore access.";
  if (subscription.status === "TRIAL") {
    if (!subscription.trial_ends_at) return "Your trial has no end date. Contact Web365 to restore access.";
    if (new Date(subscription.trial_ends_at).getTime() <= Date.now()) return "Your free trial has ended. Choose a plan on the subscription page to continue.";
  }
  // A paid period that has run out (not renewed, or cancelled) no longer gives access.
  if (subscription.status === "ACTIVE" && subscription.current_period_end && new Date(subscription.current_period_end).getTime() <= Date.now()) {
    return subscription.cancel_at_period_end
      ? "Your subscription was cancelled and has ended. Choose a plan on the subscription page to come back."
      : "Your subscription period has ended. Renew on the subscription page to continue.";
  }
  if (subscription.status === "GRACE") {
    if (!subscription.current_period_end) return "Your subscription grace period has no end date. Contact Web365 to restore access.";
    if (new Date(subscription.current_period_end).getTime() <= Date.now()) return "Your subscription grace period has ended. Contact Web365 to restore access.";
  }
  if (!["TRIAL", "ACTIVE", "GRACE"].includes(subscription.status)) {
    return `Your subscription is ${subscription.status.toLowerCase().replaceAll("_", " ")}. Renew on the subscription page, or contact Web365.`;
  }
  return null;
}

export async function subscriptionAccessProblem() {
  return subscriptionProblem(await currentSubscription());
}

export async function assertSubscriptionAccess() {
  const problem = await subscriptionAccessProblem();
  if (problem) throw new DomainError(problem, 402);
}

export async function assertPlanLimit(resource: "outlets" | "staff", used: number) {
  const subscription = await currentSubscription();
  const problem = subscriptionProblem(subscription);
  if (problem) throw new DomainError(problem, 402);
  if (!subscription) return;
  const limit = resource === "outlets" ? subscription.max_outlets : subscription.max_staff_accounts;
  if (limit !== null && used >= limit) {
    const label = resource === "outlets" ? (limit === 1 ? "outlet" : "outlets") : "staff accounts";
    throw new DomainError(`The ${subscription.plan_name} plan allows up to ${limit} ${label}. Change the plan or increase its limit to add more.`, 403);
  }
}

export async function assertPlanFeature(feature: string) {
  const subscription = await currentSubscription();
  const problem = subscriptionProblem(subscription);
  if (problem) throw new DomainError(problem, 402);
  if (subscription?.features && !subscription.features.includes(feature)) {
    throw new DomainError(`The ${subscription.plan_name} plan does not include ${feature.replaceAll("_", " ")}.`, 403);
  }
}

export async function subscriptionOverview() {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  return {
    planName: subscription.plan_name,
    status: subscription.status,
    billingCycle: subscription.billing_cycle,
    trialEndsAt: subscription.trial_ends_at ? new Date(subscription.trial_ends_at).toISOString() : null,
    currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end).toISOString() : null,
    maxOutlets: subscription.max_outlets,
    maxStaffAccounts: subscription.max_staff_accounts,
    outletCount: outlets.filter((outlet) => outlet.status !== "CLOSED").length,
    staffCount: users.filter((user) => user.status !== "DEACTIVATED").length,
    problem: subscriptionProblem(subscription),
    planId: subscription.plan_id,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    scheduledChange: subscription.scheduled_plan_id ? { planName: subscription.scheduled_plan_name ?? subscription.scheduled_plan_id, billingCycle: subscription.scheduled_billing_cycle } : null,
    cardLabel: subscription.card_label,
    isDemo: subscription.is_demo,
  };
}
