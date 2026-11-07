// Subscription billing: quotes, checkout, settlement, scheduled changes and cancellation.
//
// The one rule: a subscription is activated, renewed or upgraded only by settlePayment(), and only after the
// payment has been verified with the provider's API (status, reference, amount and currency all match).
// The browser redirect after checkout and the provider's webhook both just ask settlePayment() to check.
// Settlement locks the payment row, so concurrent or repeated calls apply a payment exactly once.
import { randomBytes, randomUUID } from "node:crypto";
import { addMonths, addYears } from "date-fns";

import { platformQuery, withDatabaseTransaction, type PlatformQuery } from "@/lib/db/database";
import { users } from "@/lib/data";
import { billingProvider } from "@/lib/billing/paystack";
import { PaymentProviderError, toMinorUnits, type VerifiedPayment } from "@/lib/billing/provider";
import { DomainError, recordAudit } from "@/lib/erp/services";
import type { Actor } from "@/lib/erp/types";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { runInTenant } from "@/lib/saas/tenant";

export type BillingCycle = "MONTHLY" | "ANNUAL";
type Purpose = "START" | "RENEWAL" | "UPGRADE";

type PlanRow = { id: string; name: string; monthly_price: string | null; annual_price: string | null; currency: string; is_active: boolean };
type SubscriptionRow = {
  id: string; tenant_id: string; plan_id: string; status: string; billing_cycle: BillingCycle; trial_ends_at: Date | null; current_period_end: Date | null;
  cancel_at_period_end: boolean; scheduled_plan_id: string | null; scheduled_billing_cycle: BillingCycle | null; card_label: string | null; is_demo: boolean;
};
type PaymentRow = {
  id: string; tenant_id: string; provider: string; reference: string; purpose: Purpose; plan_id: string; billing_cycle: BillingCycle; amount: string; credit: string;
  currency: string; status: string; initiated_by: string | null; initiated_by_name: string | null; created_at: Date; paid_at: Date | null; failure_reason: string | null;
};

const price = (plan: PlanRow, cycle: BillingCycle) => {
  const value = cycle === "MONTHLY" ? plan.monthly_price : plan.annual_price;
  return value === null ? null : Number(value);
};
const addCycle = (date: Date, cycle: BillingCycle) => (cycle === "MONTHLY" ? addMonths(date, 1) : addYears(date, 1));
const cycleDays = (cycle: BillingCycle) => (cycle === "MONTHLY" ? 30 : 365);
const round2 = (value: number) => Math.round(value * 100) / 100;

async function loadState(query: PlatformQuery, tenantId: string, lock = false) {
  const [subscription] = await query<SubscriptionRow>(
    `SELECT s.id, s.tenant_id, s.plan_id, s.status, s.billing_cycle, s.trial_ends_at, s.current_period_end, s.cancel_at_period_end,
            s.scheduled_plan_id, s.scheduled_billing_cycle, s.card_label, t.is_demo
     FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE s.tenant_id = $1${lock ? " FOR UPDATE OF s" : ""}`,
    [tenantId],
  );
  const plans = await query<PlanRow>(`SELECT id, name, monthly_price, annual_price, currency, is_active FROM plans`);
  return { subscription, plans };
}

export type Quote =
  | { kind: "payment"; purpose: Purpose; planId: string; planName: string; billingCycle: BillingCycle; subtotal: number; credit: number; amount: number; currency: string; periodStart: string; periodEnd: string }
  | { kind: "scheduled-downgrade"; planId: string; planName: string; billingCycle: BillingCycle; effectiveAt: string };

/** What choosing this plan and cycle means for the pharmacy right now. */
export function quoteFor(state: Awaited<ReturnType<typeof loadState>>, planId: string, cycle: BillingCycle, now = new Date()): Quote {
  const { subscription, plans } = state;
  if (!subscription) throw new DomainError("This pharmacy has no subscription. Contact Web365.", 409);
  if (subscription.is_demo) throw new DomainError("The demo pharmacy is complimentary and cannot be billed.", 409);
  const plan = plans.find((entry) => entry.id === planId && entry.is_active);
  if (!plan) throw new DomainError("Choose one of the plans offered.", 400);
  const amount = price(plan, cycle);
  if (amount === null || amount <= 0) throw new DomainError(`The ${plan.name} plan has no ${cycle === "MONTHLY" ? "monthly" : "annual"} price yet. Contact Web365.`, 409);

  const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  const activePeriod = subscription.status === "ACTIVE" && periodEnd && periodEnd > now;
  const samePlan = planId === subscription.plan_id && cycle === subscription.billing_cycle;

  if (activePeriod && !samePlan) {
    const current = plans.find((entry) => entry.id === subscription.plan_id);
    const currentPrice = current ? price(current, subscription.billing_cycle) : null;
    // Compare by daily rate: cheaper plans (or cycles) take effect when the paid period ends, without payment.
    if (currentPrice !== null && amount / cycleDays(cycle) < currentPrice / cycleDays(subscription.billing_cycle)) {
      return { kind: "scheduled-downgrade", planId, planName: plan.name, billingCycle: cycle, effectiveAt: periodEnd!.toISOString() };
    }
    // Upgrade now, with credit for the unused part of the current paid period.
    const periodLength = addCycle(new Date(0), subscription.billing_cycle).getTime();
    const credit = currentPrice ? round2(Math.min(currentPrice, (currentPrice * (periodEnd!.getTime() - now.getTime())) / periodLength)) : 0;
    const due = round2(Math.max(amount - credit, 0));
    if (due < 1) throw new DomainError("Nothing is due for this change. Contact Web365 to switch plans.", 409);
    return { kind: "payment", purpose: "UPGRADE", planId, planName: plan.name, billingCycle: cycle, subtotal: amount, credit, amount: due, currency: plan.currency, periodStart: now.toISOString(), periodEnd: addCycle(now, cycle).toISOString() };
  }

  // Start (from trial) or renew: the paid period begins when the current trial or paid period ends.
  const trialEnd = subscription.status === "TRIAL" && subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
  const start = new Date(Math.max(now.getTime(), trialEnd?.getTime() ?? 0, activePeriod ? periodEnd!.getTime() : 0));
  const purpose: Purpose = subscription.status === "TRIAL" || !samePlan ? "START" : "RENEWAL";
  return { kind: "payment", purpose, planId, planName: plan.name, billingCycle: cycle, subtotal: amount, credit: 0, amount, currency: plan.currency, periodStart: start.toISOString(), periodEnd: addCycle(start, cycle).toISOString() };
}

export async function quote(tenantId: string, planId: string, cycle: BillingCycle) {
  return quoteFor(await platformQuery((query) => loadState(query, tenantId)), planId, cycle);
}

function appUrl() {
  const base = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (!base) throw new DomainError("Set APP_URL so payments can return to the app.", 503);
  return base.replace(/\/$/, "");
}

/**
 * Step 1 of checkout, inside the pharmacy's transaction: the quote for the chosen plan. A downgrade is
 * scheduled for the end of the paid period right here (no payment); anything else needs step 2.
 */
export async function prepareCheckout(actor: Actor, planId: string, cycle: BillingCycle) {
  const tenantId = actor.tenantId;
  if (!tenantId) throw new DomainError("No pharmacy selected.", 401);
  const result = await quote(tenantId, planId, cycle);
  if (result.kind === "scheduled-downgrade") {
    await platformQuery((query) => query(`UPDATE subscriptions SET scheduled_plan_id = $1, scheduled_billing_cycle = $2, updated_at = now() WHERE tenant_id = $3`, [planId, cycle, tenantId]));
    recordAudit(actor, { action: "billing.downgrade-scheduled", entity: "Subscription", entityId: tenantId, summary: `Scheduled a change to ${result.planName} (${cycle.toLowerCase()}) from ${result.effectiveAt.slice(0, 10)}` });
    return { kind: "scheduled" as const, quote: result };
  }
  if (!(await billingProvider().configured())) throw new DomainError("Online payment is not set up yet. Contact Web365 to pay.", 503);
  const email = users.find((user) => user.id === actor.id)?.email;
  if (!email) throw new DomainError("Your account has no email address for the payment receipt.", 409);
  return { kind: "payment" as const, quote: result, tenantId, email, actor: { id: actor.id, name: actor.name } };
}

/**
 * Step 2, outside any transaction (no database lock is held while the provider is called): records the
 * pending payment for the server-calculated amount, then opens the provider's checkout for exactly that.
 */
export async function openCheckout(prepared: Extract<Awaited<ReturnType<typeof prepareCheckout>>, { kind: "payment" }>) {
  const { quote: result, tenantId, email, actor } = prepared;
  const provider = billingProvider();
  const id = `pay-${randomUUID()}`;
  const reference = `W365-${tenantId.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  await platformQuery((query) =>
    query(
      `INSERT INTO billing_payments (id, tenant_id, provider, reference, purpose, plan_id, billing_cycle, amount, credit, currency, initiated_by, initiated_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, tenantId, provider.name, reference, result.purpose, result.planId, result.billingCycle, result.amount, result.credit, result.currency, actor.id, actor.name],
    ),
  );
  try {
    const { checkoutUrl } = await provider.initialize({
      email,
      amountMinor: toMinorUnits(result.amount),
      currency: result.currency,
      reference,
      callbackUrl: `${appUrl()}/billing/callback`,
      metadata: { tenantId, paymentId: id, purpose: result.purpose, planId: result.planId, billingCycle: result.billingCycle },
    });
    return { paymentId: id, reference, checkoutUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Payment could not be started.";
    await platformQuery((query) => query(`UPDATE billing_payments SET status = 'FAILED', failure_reason = $1, updated_at = now() WHERE id = $2`, [reason.slice(0, 300), id]));
    throw new DomainError(error instanceof PaymentProviderError ? "The payment page could not be opened. Please try again shortly." : reason, 502);
  }
}

export type Settlement = { outcome: "activated" | "already" | "failed" | "pending" | "rejected" | "unknown"; tenantId: string | null; reference: string; message: string };

/**
 * Verifies a payment with the provider and applies it exactly once. Safe to call from the checkout redirect,
 * the webhook, or a manual re-check, in any order and any number of times.
 */
export async function settlePayment(reference: string, source: "callback" | "webhook" | "manual"): Promise<Settlement> {
  const [known] = await platformQuery<PaymentRow[]>((query) => query<PaymentRow>(`SELECT * FROM billing_payments WHERE reference = $1`, [reference]));
  if (!known) return { outcome: "unknown", tenantId: null, reference, message: "Unknown payment reference." };
  if (known.status === "SUCCESS") return { outcome: "already", tenantId: known.tenant_id, reference, message: "This payment was already applied." };

  // Ask the provider (server to server). Nothing in the redirect URL or the webhook body is trusted.
  let verified: VerifiedPayment;
  try {
    verified = await billingProvider().verify(reference);
  } catch (error) {
    console.error("[billing] verify failed", error);
    return { outcome: "pending", tenantId: known.tenant_id, reference, message: "The payment could not be confirmed yet. It will be applied as soon as the provider confirms it." };
  }

  const result = await platformQuery(async (query): Promise<Settlement & { invoiceNumber?: string; planName?: string; periodEnd?: string; amount?: string; currency?: string }> => {
    const [payment] = await query<PaymentRow>(`SELECT * FROM billing_payments WHERE reference = $1 FOR UPDATE`, [reference]);
    if (payment.status === "SUCCESS") return { outcome: "already", tenantId: payment.tenant_id, reference, message: "This payment was already applied." };

    if (verified.status === "pending") return { outcome: "pending", tenantId: payment.tenant_id, reference, message: "The payment is not finished yet." };
    if (verified.status !== "success") {
      const status = verified.status === "abandoned" ? "ABANDONED" : "FAILED";
      await query(`UPDATE billing_payments SET status = $1, failure_reason = $2, settled_by = $3, updated_at = now() WHERE id = $4`, [status, (verified.failureReason ?? verified.status).slice(0, 300), source, payment.id]);
      return { outcome: "failed", tenantId: payment.tenant_id, reference, message: verified.status === "abandoned" ? "The payment was not completed." : `The payment failed: ${verified.failureReason ?? "declined"}.` };
    }
    // The provider says paid: it must be this payment, for exactly the amount and currency we asked for.
    const expectedMinor = toMinorUnits(Number(payment.amount));
    if (verified.reference !== reference || verified.currency !== payment.currency || verified.amountMinor !== expectedMinor) {
      const reason = `Verification mismatch: provider reported ${verified.currency} ${verified.amountMinor / 100} for ${verified.reference}, expected ${payment.currency} ${expectedMinor / 100}`;
      await query(`UPDATE billing_payments SET status = 'FAILED', failure_reason = $1, settled_by = $2, updated_at = now() WHERE id = $3`, [reason, source, payment.id]);
      return { outcome: "rejected", tenantId: payment.tenant_id, reference, message: "The payment did not match what was due and was not applied. Web365 has been alerted." };
    }

    // Apply to the subscription, from the state it is in now.
    const state = await loadState(query, payment.tenant_id, true);
    const subscription = state.subscription;
    const plan = state.plans.find((entry) => entry.id === payment.plan_id)!;
    const now = new Date();
    const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
    const activePeriod = subscription.status === "ACTIVE" && periodEnd && periodEnd > now;
    const trialEnd = subscription.status === "TRIAL" && subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
    const start = payment.purpose === "UPGRADE" ? now : new Date(Math.max(now.getTime(), trialEnd?.getTime() ?? 0, activePeriod ? periodEnd!.getTime() : 0));
    const end = addCycle(start, payment.billing_cycle);
    await query(
      `UPDATE subscriptions SET plan_id = $1, billing_cycle = $2, status = 'ACTIVE', current_period_end = $3, cancel_at_period_end = false,
              scheduled_plan_id = NULL, scheduled_billing_cycle = NULL, provider = $4,
              provider_customer_code = COALESCE($5, provider_customer_code), authorization_code = COALESCE($6, authorization_code), card_label = COALESCE($7, card_label), updated_at = now()
       WHERE tenant_id = $8`,
      [payment.plan_id, payment.billing_cycle, end, payment.provider, verified.customerCode, verified.authorization?.code ?? null, verified.authorization?.label ?? null, payment.tenant_id],
    );
    await query(
      `UPDATE billing_payments SET status = 'SUCCESS', paid_at = $1, provider_transaction_id = $2, channel = $3, settled_by = $4, failure_reason = NULL, updated_at = now() WHERE id = $5`,
      [verified.paidAt ? new Date(verified.paidAt) : now, verified.transactionId, verified.channel, source, payment.id],
    );
    const [tenant] = await query<{ name: string; business_email: string | null; business_phone: string | null; address: string | null; state: string | null; country: string }>(
      `SELECT name, business_email, business_phone, address, state, country FROM tenants WHERE id = $1`,
      [payment.tenant_id],
    );
    const [{ seq }] = await query<{ seq: string }>(`SELECT nextval('invoice_number_seq') AS seq`);
    const number = `W365-${now.getUTCFullYear()}-${String(seq).padStart(6, "0")}`;
    await query(
      `INSERT INTO invoices (id, number, tenant_id, payment_id, plan_id, plan_name, billing_cycle, period_start, period_end, subtotal, credit, total, currency, bill_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [`inv-${randomUUID()}`, number, payment.tenant_id, payment.id, plan.id, plan.name, payment.billing_cycle, start, end, Number(payment.amount) + Number(payment.credit), Number(payment.credit), Number(payment.amount), payment.currency, JSON.stringify(tenant)],
    );
    return { outcome: "activated", tenantId: payment.tenant_id, reference, message: `Payment received. ${plan.name} is active until ${end.toISOString().slice(0, 10)}.`, invoiceNumber: number, planName: plan.name, periodEnd: end.toISOString(), amount: payment.amount, currency: payment.currency };
  });

  // Audit trails (after the payment transaction has committed).
  if (result.tenantId && ["activated", "failed", "rejected"].includes(result.outcome)) {
    const summary = result.outcome === "activated"
      ? `Payment ${reference} of ${result.currency} ${Number(result.amount).toLocaleString("en-NG")} confirmed (${source}); ${result.planName} active until ${result.periodEnd!.slice(0, 10)}; invoice ${result.invoiceNumber}`
      : `Payment ${reference} ${result.outcome} (${source}): ${result.message}`;
    const severity = result.outcome === "rejected" ? "critical" : result.outcome === "failed" ? "warning" : "info";
    await runInTenant(result.tenantId, () => withDatabaseTransaction(() => {
      recordAudit({ id: "system:billing", name: "Billing", role: "SUPER_ADMIN" }, { action: `billing.payment-${result.outcome}`, entity: "Payment", entityId: reference, summary, severity });
    })).catch((error) => console.error("[billing] tenant audit failed", error));
    await recordPlatformAudit({ id: null, name: "Billing", type: "system" }, { action: `billing.payment-${result.outcome}`, targetType: "Payment", targetId: reference, tenantId: result.tenantId, summary, severity });
  }
  return { outcome: result.outcome, tenantId: result.tenantId, reference: result.reference, message: result.message };
}

/** Cancel at the end of the paid period (no refund), or undo that. */
export async function setCancelAtPeriodEnd(actor: Actor, cancel: boolean) {
  const tenantId = actor.tenantId;
  if (!tenantId) throw new DomainError("No pharmacy selected.", 401);
  const [subscription] = await platformQuery<SubscriptionRow[]>((query) => query<SubscriptionRow>(`SELECT s.*, false AS is_demo FROM subscriptions s WHERE tenant_id = $1`, [tenantId]));
  if (!subscription) throw new DomainError("This pharmacy has no subscription.", 409);
  if (subscription.status !== "ACTIVE" || !subscription.current_period_end) throw new DomainError("Only an active paid subscription can be cancelled. A trial simply ends.", 409);
  await platformQuery((query) => query(`UPDATE subscriptions SET cancel_at_period_end = $1, scheduled_plan_id = CASE WHEN $1 THEN NULL ELSE scheduled_plan_id END, updated_at = now() WHERE tenant_id = $2`, [cancel, tenantId]));
  const ends = new Date(subscription.current_period_end).toISOString().slice(0, 10);
  recordAudit(actor, { action: cancel ? "billing.cancel" : "billing.resume", entity: "Subscription", entityId: tenantId, summary: cancel ? `Cancelled the subscription; access continues until ${ends}` : "Kept the subscription (cancellation withdrawn)", severity: cancel ? "warning" : "info" });
  await recordPlatformAudit({ id: actor.id, name: `${actor.name} (pharmacy)`, type: "pharmacy" }, { action: cancel ? "billing.cancel" : "billing.resume", targetType: "Subscription", targetId: tenantId, tenantId, summary: cancel ? `Cancelled at period end (${ends})` : "Cancellation withdrawn" });
  return { cancelAtPeriodEnd: cancel, periodEnd: ends };
}

export async function clearScheduledChange(actor: Actor) {
  const tenantId = actor.tenantId;
  if (!tenantId) throw new DomainError("No pharmacy selected.", 401);
  await platformQuery((query) => query(`UPDATE subscriptions SET scheduled_plan_id = NULL, scheduled_billing_cycle = NULL, updated_at = now() WHERE tenant_id = $1`, [tenantId]));
  recordAudit(actor, { action: "billing.downgrade-cancelled", entity: "Subscription", entityId: tenantId, summary: "Withdrew the scheduled plan change" });
  return { ok: true };
}

export type PaymentView = { id: string; reference: string; purpose: string; plan: string; billingCycle: string; amount: number; credit: number; currency: string; status: string; failureReason: string | null; createdAt: string; paidAt: string | null; by: string | null; invoice: { id: string; number: string } | null };

export async function paymentsFor(tenantId: string): Promise<PaymentView[]> {
  const rows = await platformQuery<Array<PaymentRow & { plan_name: string; invoice_id: string | null; invoice_number: string | null }>>((query) =>
    query(
      `SELECT b.*, p.name AS plan_name, i.id AS invoice_id, i.number AS invoice_number
       FROM billing_payments b JOIN plans p ON p.id = b.plan_id LEFT JOIN invoices i ON i.payment_id = b.id
       WHERE b.tenant_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
      [tenantId],
    ),
  );
  return rows.map((row) => ({
    id: row.id, reference: row.reference, purpose: row.purpose, plan: row.plan_name, billingCycle: row.billing_cycle, amount: Number(row.amount), credit: Number(row.credit), currency: row.currency,
    status: row.status, failureReason: row.failure_reason, createdAt: new Date(row.created_at).toISOString(), paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null, by: row.initiated_by_name,
    invoice: row.invoice_id ? { id: row.invoice_id, number: row.invoice_number! } : null,
  }));
}

export type InvoiceView = {
  id: string; number: string; tenantId: string; planName: string; billingCycle: string; periodStart: string; periodEnd: string; subtotal: number; credit: number; total: number; currency: string;
  status: string; issuedAt: string; reference: string; billTo: { name: string; business_email: string | null; business_phone: string | null; address: string | null; state: string | null; country: string };
};

/** One invoice; tenantId limits it to that pharmacy (null: platform staff). */
export async function invoiceById(id: string, tenantId: string | null): Promise<InvoiceView> {
  const [row] = await platformQuery<Array<{ id: string; number: string; tenant_id: string; plan_name: string; billing_cycle: string; period_start: Date; period_end: Date; subtotal: string; credit: string; total: string; currency: string; status: string; issued_at: Date; bill_to: InvoiceView["billTo"]; reference: string }>>((query) =>
    query(`SELECT i.*, b.reference FROM invoices i JOIN billing_payments b ON b.id = i.payment_id WHERE i.id = $1 AND ($2::text IS NULL OR i.tenant_id = $2)`, [id, tenantId]),
  );
  if (!row) throw new DomainError("Invoice not found.", 404);
  return {
    id: row.id, number: row.number, tenantId: row.tenant_id, planName: row.plan_name, billingCycle: row.billing_cycle, periodStart: new Date(row.period_start).toISOString(), periodEnd: new Date(row.period_end).toISOString(),
    subtotal: Number(row.subtotal), credit: Number(row.credit), total: Number(row.total), currency: row.currency, status: row.status, issuedAt: new Date(row.issued_at).toISOString(), reference: row.reference,
    billTo: typeof row.bill_to === "string" ? JSON.parse(row.bill_to) : row.bill_to,
  };
}
