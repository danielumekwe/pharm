// Refunds of subscription payments. One billing administrator requests a refund with a reason; a second one
// approves it (unless the subscription policy allows a single person); only then is it sent to the payment
// provider. The amount can never exceed what was paid minus refunds already requested or made. A refund
// changes no subscription: staff adjust the subscription separately if access should end.
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { billingProvider } from "@/lib/billing/paystack";
import { toMinorUnits, type ProviderRefund } from "@/lib/billing/provider";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { readPlatformSetting } from "@/lib/platform/settings";

export const refundRequestSchema = z.object({
  amount: z.number().finite().positive().refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Enter at most two decimal places."),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500),
});

type RefundRow = {
  id: string; tenant_id: string; payment_id: string; amount: string; currency: string; reason: string; status: string; requested_by: string; requested_by_name: string;
  requested_at: Date; decided_by_name: string | null; decided_at: Date | null; decision_note: string | null; provider_refund_id: string | null; provider_status: string | null;
  last_error: string | null; processed_at: Date | null;
};

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);
const view = (row: RefundRow & { reference?: string }) => ({
  id: row.id, paymentId: row.payment_id, reference: row.reference ?? null, amount: Number(row.amount), currency: row.currency, reason: row.reason, status: row.status,
  requestedBy: row.requested_by_name, requestedById: row.requested_by, requestedAt: iso(row.requested_at)!, decidedBy: row.decided_by_name, decidedAt: iso(row.decided_at),
  note: row.decision_note, providerStatus: row.provider_status, error: row.last_error, processedAt: iso(row.processed_at),
});
export type RefundView = ReturnType<typeof view>;

/** Refunds still counting against the payment (requested, sent, or done). */
const COMMITTED = `('REQUESTED', 'PENDING', 'PROCESSED')`;

export async function refundsFor(tenantId: string): Promise<RefundView[]> {
  const rows = await platformQuery<Array<RefundRow & { reference: string }>>((query) =>
    query(`SELECT r.*, b.reference FROM billing_refunds r JOIN billing_payments b ON b.id = r.payment_id WHERE r.tenant_id = $1 ORDER BY r.requested_at DESC`, [tenantId]),
  );
  return rows.map(view);
}

/** Refunds waiting for a decision, across all pharmacies. */
export async function refundsAwaitingApproval() {
  const rows = await platformQuery<Array<RefundRow & { reference: string; tenant: string }>>((query) =>
    query(`SELECT r.*, b.reference, t.name AS tenant FROM billing_refunds r JOIN billing_payments b ON b.id = r.payment_id JOIN tenants t ON t.id = r.tenant_id WHERE r.status = 'REQUESTED' ORDER BY r.requested_at`),
  );
  return rows.map((row) => ({ ...view(row), tenant: row.tenant, tenantId: row.tenant_id }));
}

/** What can still be refunded on a payment. */
export async function refundable(paymentId: string) {
  const [row] = await platformQuery<Array<{ amount: string; currency: string; status: string; committed: string }>>((query) =>
    query(`SELECT b.amount, b.currency, b.status, coalesce((SELECT sum(r.amount) FROM billing_refunds r WHERE r.payment_id = b.id AND r.status IN ${COMMITTED}), 0) AS committed FROM billing_payments b WHERE b.id = $1`, [paymentId]),
  );
  if (!row) return null;
  return { paid: Number(row.amount), refunded: Number(row.committed), remaining: Math.max(0, Number(row.amount) - Number(row.committed)), currency: row.currency, status: row.status };
}

export async function requestRefund(actor: PlatformActor, paymentId: string, input: z.infer<typeof refundRequestSchema>) {
  const id = `refund-${randomUUID()}`;
  // Checked and inserted in one transaction with the payment row locked, so two requests cannot together
  // exceed the amount paid.
  const created = await platformQuery(async (query) => {
    const [payment] = await query<{ tenant_id: string; reference: string; amount: string; currency: string; status: string; tenant: string }>(
      `SELECT b.tenant_id, b.reference, b.amount, b.currency, b.status, t.name AS tenant FROM billing_payments b JOIN tenants t ON t.id = b.tenant_id WHERE b.id = $1 FOR UPDATE OF b`,
      [paymentId],
    );
    if (!payment) throw new DomainError("Payment not found.", 404);
    if (payment.status !== "SUCCESS") throw new DomainError("Only a successful payment can be refunded.");
    const [{ committed }] = await query<{ committed: string }>(`SELECT coalesce(sum(amount), 0) AS committed FROM billing_refunds WHERE payment_id = $1 AND status IN ${COMMITTED}`, [paymentId]);
    const remaining = Number(payment.amount) - Number(committed);
    if (input.amount - remaining > 1e-6) throw new DomainError(`At most ${payment.currency} ${remaining.toFixed(2)} can still be refunded on this payment.`);
    await query(
      `INSERT INTO billing_refunds (id, tenant_id, payment_id, amount, currency, reason, requested_by, requested_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, payment.tenant_id, paymentId, input.amount, payment.currency, input.reason, actor.id, actor.name],
    );
    return payment;
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "billing.refund-requested", targetType: "Refund", targetId: id, tenantId: created.tenant_id, severity: "warning", summary: `Requested a refund of ${created.currency} ${input.amount.toFixed(2)} on payment ${created.reference} (${created.tenant}): ${input.reason}` });
  const policy = await readPlatformSetting("subscriptions.policy");
  if (policy.value.refundApproval === "single") return decideRefund(actor, id, "approve", "Single-person approval (subscription policy)");
  return { ok: true, refund: await refundById(id) };
}

async function refundById(id: string) {
  const [row] = await platformQuery<Array<RefundRow & { reference: string }>>((query) => query(`SELECT r.*, b.reference FROM billing_refunds r JOIN billing_payments b ON b.id = r.payment_id WHERE r.id = $1`, [id]));
  return row ? view(row) : null;
}

/** Approve (sends it to the provider) or reject a requested refund. */
export async function decideRefund(actor: PlatformActor, refundId: string, decision: "approve" | "reject", note: string) {
  const text = note.trim();
  const refund = await refundById(refundId);
  if (!refund) throw new DomainError("Refund not found.", 404);
  if (refund.status !== "REQUESTED") throw new DomainError(`This refund was already ${refund.status.toLowerCase()}.`, 409);
  if (decision === "reject") {
    if (text.length < 5) throw new DomainError("Give a reason for rejecting it (at least 5 characters).");
    const done = await platformQuery<Array<{ id: string }>>((query) => query(`UPDATE billing_refunds SET status = 'REJECTED', decided_by = $1, decided_by_name = $2, decided_at = now(), decision_note = $3, updated_at = now() WHERE id = $4 AND status = 'REQUESTED' RETURNING id`, [actor.id, actor.name, text, refundId]));
    if (!done.length) throw new DomainError("This refund was already decided.", 409);
    await recordPlatformAudit(platformActorRef(actor), { action: "billing.refund-rejected", targetType: "Refund", targetId: refundId, summary: `Rejected the refund of ${refund.currency} ${refund.amount.toFixed(2)} on ${refund.reference}: ${text}` });
    return { ok: true, refund: await refundById(refundId) };
  }
  const policy = await readPlatformSetting("subscriptions.policy");
  if (policy.value.refundApproval === "two_person" && refund.requestedById === actor.id) throw new DomainError("A second billing administrator must approve this refund (you requested it).", 403);
  // Claim it before calling the provider, so it can only ever be sent once.
  const claimed = await platformQuery<Array<{ id: string }>>((query) =>
    query(`UPDATE billing_refunds SET status = 'PENDING', decided_by = $1, decided_by_name = $2, decided_at = now(), decision_note = $3, updated_at = now() WHERE id = $4 AND status = 'REQUESTED' RETURNING id`, [actor.id, actor.name, text || null, refundId]),
  );
  if (!claimed.length) throw new DomainError("This refund was already decided.", 409);
  let result: ProviderRefund;
  try {
    result = await billingProvider().refund({ reference: refund.reference!, amountMinor: toMinorUnits(refund.amount), currency: refund.currency, note: `Web365 refund ${refundId}: ${refund.reason}` });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Refund failed").slice(0, 300);
    if (/could not be reached/i.test(message)) {
      // The request may have reached the provider: keep the amount reserved and let a person check.
      await platformQuery((query) => query(`UPDATE billing_refunds SET last_error = $1, updated_at = now() WHERE id = $2`, [`${message} The refund may or may not have been made: check the Paystack dashboard before doing anything else.`, refundId]));
      await recordPlatformAudit(platformActorRef(actor), { action: "billing.refund-unknown", targetType: "Refund", targetId: refundId, severity: "critical", summary: `Refund ${refundId} on ${refund.reference}: the provider could not be reached; check the Paystack dashboard` });
      return { ok: false, refund: await refundById(refundId) };
    }
    await platformQuery((query) => query(`UPDATE billing_refunds SET status = 'FAILED', last_error = $1, updated_at = now() WHERE id = $2`, [message, refundId]));
    await recordPlatformAudit(platformActorRef(actor), { action: "billing.refund-failed", targetType: "Refund", targetId: refundId, severity: "warning", summary: `Refund of ${refund.currency} ${refund.amount.toFixed(2)} on ${refund.reference} was refused by the provider: ${message}` });
    return { ok: false, refund: await refundById(refundId) };
  }
  await applyProviderState(refundId, result);
  await recordPlatformAudit(platformActorRef(actor), { action: "billing.refund-approved", targetType: "Refund", targetId: refundId, severity: "warning", summary: `Approved and sent a refund of ${refund.currency} ${refund.amount.toFixed(2)} on ${refund.reference} (requested by ${refund.requestedBy}); provider status ${result.status}` });
  return { ok: true, refund: await refundById(refundId) };
}

async function applyProviderState(refundId: string, state: ProviderRefund) {
  const status = state.status === "processed" ? "PROCESSED" : state.status === "failed" ? "FAILED" : "PENDING";
  await platformQuery(async (query) => {
    await query(
      `UPDATE billing_refunds SET status = $1, provider_refund_id = $2, provider_status = $3, last_error = $4, processed_at = CASE WHEN $1 = 'PROCESSED' THEN coalesce(processed_at, now()) ELSE processed_at END, updated_at = now() WHERE id = $5`,
      [status, state.id, state.detail, status === "FAILED" ? state.detail : null, refundId],
    );
    // Invoice status follows what has actually been refunded.
    await query(
      `UPDATE invoices SET status = CASE WHEN x.done >= x.paid THEN 'REFUNDED' WHEN x.done > 0 THEN 'PARTIALLY_REFUNDED' ELSE 'PAID' END
       FROM (SELECT b.id, b.amount AS paid, coalesce((SELECT sum(r.amount) FROM billing_refunds r WHERE r.payment_id = b.id AND r.status = 'PROCESSED'), 0) AS done
             FROM billing_payments b WHERE b.id = (SELECT payment_id FROM billing_refunds WHERE id = $1)) x
       WHERE invoices.payment_id = x.id`,
      [refundId],
    );
  });
  return status;
}

/** Asks the provider for the refund's current state (the "check again" button and refund webhooks). */
export async function syncRefund(refundId: string) {
  const [row] = await platformQuery<Array<{ provider_refund_id: string | null; status: string }>>((query) => query(`SELECT provider_refund_id, status FROM billing_refunds WHERE id = $1`, [refundId]));
  if (!row) throw new DomainError("Refund not found.", 404);
  if (!row.provider_refund_id) return { status: row.status, changed: false };
  if (row.status !== "PENDING") return { status: row.status, changed: false };
  const status = await applyProviderState(refundId, await billingProvider().fetchRefund(row.provider_refund_id));
  if (status !== "PENDING") await recordPlatformAudit({ id: null, name: "Payment provider", type: "system" }, { action: `billing.refund-${status.toLowerCase()}`, targetType: "Refund", targetId: refundId, severity: status === "FAILED" ? "warning" : "info", summary: `Refund ${refundId} is now ${status.toLowerCase()}` });
  return { status, changed: status !== "PENDING" };
}

/** For a refund webhook: re-checks every sent refund on that transaction. */
export async function syncRefundsForReference(reference: string) {
  const rows = await platformQuery<Array<{ id: string }>>((query) =>
    query(`SELECT r.id FROM billing_refunds r JOIN billing_payments b ON b.id = r.payment_id WHERE b.reference = $1 AND r.status = 'PENDING'`, [reference]),
  );
  const results = [];
  for (const { id } of rows) results.push(await syncRefund(id));
  return results.length ? results.map((entry) => entry.status.toLowerCase()).join(",") : "no pending refund";
}
