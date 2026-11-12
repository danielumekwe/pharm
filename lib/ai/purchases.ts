// AI coin purchases through the existing Paystack integration (lib/billing).
//
// The one rule (as for subscriptions): coins are credited only by settleCoinPurchase(), and only after the
// payment has been verified with Paystack's API — status, reference, amount and currency must all match the
// pending purchase recorded on the server. The browser redirect and the webhook only ask for that check.
// The purchase row is locked while it is settled and the wallet credit uses the purchase as its idempotency
// key, so duplicate webhooks, double redirects or a re-check never credit twice. A verified payment whose
// credit did not complete stays PENDING and is retried by the reconciliation job (no second payment needed).

import { randomBytes, randomUUID } from "node:crypto";

import { users } from "@/lib/data";
import { platformQuery, type PlatformQuery } from "@/lib/db/database";
import { billingProvider } from "@/lib/billing/paystack";
import { PaymentProviderError, toMinorUnits, type VerifiedPayment } from "@/lib/billing/provider";
import { assertCan, DomainError, recordAudit } from "@/lib/erp/services";
import type { Actor } from "@/lib/erp/types";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { runInTenant } from "@/lib/saas/tenant";
import { withDatabaseTransaction } from "@/lib/db/database";

import { deliverWalletEvents, notifyPharmacy, sendOwnerEmail } from "./notify";
import { ensureWallet, postEntry, walletConfig, walletFor, type WalletEvent } from "./wallet";

export const PURCHASE_PREFIX = "AIC-";

export type CoinPackage = { id: string; name: string; description: string; coins: number; bonusCoins: number; totalCoins: number; price: number; currency: string; active: boolean; displayOrder: number; promoStartsAt: string | null; promoEndsAt: string | null; maxPerTenantPerMonth: number | null; onSale: boolean };

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);

export function packageFrom(row: Record<string, unknown>, now = new Date()): CoinPackage {
  const promoStartsAt = iso(row.promo_starts_at);
  const promoEndsAt = iso(row.promo_ends_at);
  // Bonus coins apply only inside the promotional period when one is set.
  const inPromo = (!promoStartsAt || new Date(promoStartsAt) <= now) && (!promoEndsAt || new Date(promoEndsAt) > now);
  const bonus = inPromo ? Number(row.bonus_coins) : 0;
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    coins: Number(row.coins),
    bonusCoins: bonus,
    totalCoins: Number(row.coins) + bonus,
    price: Number(row.price),
    currency: String(row.currency),
    active: Boolean(row.active),
    displayOrder: Number(row.display_order),
    promoStartsAt,
    promoEndsAt,
    maxPerTenantPerMonth: row.max_per_tenant_per_month === null ? null : Number(row.max_per_tenant_per_month),
    onSale: Boolean(row.active),
  };
}

export async function packagesForSale(query: PlatformQuery) {
  const rows = await query<Record<string, unknown>>(`SELECT id, name, description, coins, bonus_coins, price::float8 AS price, currency, active, display_order, promo_starts_at, promo_ends_at, max_per_tenant_per_month FROM ai_coin_packages WHERE active ORDER BY display_order, price`);
  return rows.map((row) => packageFrom(row));
}

function appUrl() {
  const base = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (!base) throw new DomainError("Set APP_URL so payments can return to the app.", 503);
  return base.replace(/\/$/, "");
}

/** Step 1, in the pharmacy's request: checks the package and limits. The tenant comes from the session only. */
export async function preparePurchase(actor: Actor, packageId: unknown) {
  assertCan(actor, "ai.coins.purchase");
  if (actor.support) throw new DomainError("Support sessions cannot buy coins.", 403);
  const tenantId = actor.tenantId;
  if (!tenantId) throw new DomainError("No pharmacy selected.", 401);
  if (typeof packageId !== "string") throw new DomainError("Choose a coin package.");
  return platformQuery(async (query) => {
    const [row] = await query<Record<string, unknown>>(`SELECT id, name, description, coins, bonus_coins, price::float8 AS price, currency, active, display_order, promo_starts_at, promo_ends_at, max_per_tenant_per_month FROM ai_coin_packages WHERE id = $1`, [packageId]);
    if (!row || !row.active) throw new DomainError("This coin package is not on sale.", 404);
    const pack = packageFrom(row);
    const [{ month, today }] = await query<{ month: number; today: number }>(
      `SELECT COUNT(*) FILTER (WHERE package_id = $2 AND created_at >= date_trunc('month', now()) AND status = 'SUCCESS')::int AS month,
              COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND status IN ('SUCCESS', 'PENDING'))::int AS today
         FROM ai_coin_purchases WHERE tenant_id = $1`,
      [tenantId, pack.id],
    );
    if (pack.maxPerTenantPerMonth !== null && month >= pack.maxPerTenantPerMonth) throw new DomainError(`The ${pack.name} package can be bought ${pack.maxPerTenantPerMonth} time(s) a month.`, 409);
    const config = await walletConfig(query);
    if (config.maxPurchasesPerDay !== null && today >= config.maxPurchasesPerDay) throw new DomainError(`At most ${config.maxPurchasesPerDay} coin purchases can be started per day.`, 429);
    if (!(await billingProvider().configured())) throw new DomainError("Online payment is not set up yet. Contact Web365 to buy coins.", 503);
    const email = users.find((user) => user.id === actor.id)?.email;
    if (!email) throw new DomainError("Your account has no email address for the payment receipt.", 409);
    return { pack, tenantId, email, actor: { id: actor.id, name: actor.name } };
  });
}

/** Step 2, outside any transaction: records the pending purchase for the server's price, then opens checkout. */
export async function openPurchaseCheckout(prepared: Awaited<ReturnType<typeof preparePurchase>>) {
  const { pack, tenantId, email, actor } = prepared;
  const provider = billingProvider();
  const id = `aic-${randomUUID()}`;
  const reference = `${PURCHASE_PREFIX}${tenantId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  await platformQuery((query) =>
    query(
      `INSERT INTO ai_coin_purchases (id, tenant_id, package_id, package_name, coins, bonus_coins, amount, currency, provider, reference, initiated_by, initiated_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, tenantId, pack.id, pack.name, pack.coins, pack.bonusCoins, pack.price, pack.currency, provider.name, reference, actor.id, actor.name],
    ),
  );
  try {
    const { checkoutUrl } = await provider.initialize({
      email,
      amountMinor: toMinorUnits(pack.price),
      currency: pack.currency,
      reference,
      callbackUrl: `${appUrl()}/ai-wallet/callback`,
      metadata: { kind: "ai-coins", tenantId, purchaseId: id, packageId: pack.id },
    });
    return { purchaseId: id, reference, checkoutUrl };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Payment could not be started.";
    await platformQuery((query) => query(`UPDATE ai_coin_purchases SET status = 'FAILED', failure_reason = $1, updated_at = now() WHERE id = $2`, [reason.slice(0, 300), id]));
    throw new DomainError(error instanceof PaymentProviderError ? "The payment page could not be opened. Please try again shortly." : reason, 502);
  }
}

type PurchaseRow = { id: string; tenant_id: string; package_name: string; coins: number; bonus_coins: number; amount: number; currency: string; status: string; reference: string; initiated_by: string; initiated_by_name: string };
export type PurchaseSettlement = { outcome: "credited" | "already" | "failed" | "pending" | "rejected" | "unknown"; tenantId: string | null; reference: string; message: string; coins?: number };

/**
 * Verifies a coin payment with Paystack and credits the wallet exactly once. Safe to call from the redirect,
 * the webhook, reconciliation or a manual re-check, in any order and any number of times.
 */
export async function settleCoinPurchase(reference: string, source: "callback" | "webhook" | "manual" | "reconciliation"): Promise<PurchaseSettlement> {
  const [known] = await platformQuery((query) => query<PurchaseRow>(`SELECT id, tenant_id, status FROM ai_coin_purchases WHERE reference = $1`, [reference]));
  if (!known) return { outcome: "unknown", tenantId: null, reference, message: "Unknown purchase reference." };
  if (known.status === "SUCCESS" || known.status === "REFUNDED") return { outcome: "already", tenantId: known.tenant_id, reference, message: "These coins were already added to your wallet." };

  let verified: VerifiedPayment;
  try {
    verified = await billingProvider().verify(reference);
  } catch (error) {
    console.error("[ai-coins] verify failed", error instanceof Error ? error.message : "error");
    return { outcome: "pending", tenantId: known.tenant_id, reference, message: "The payment could not be confirmed yet. The coins will be added as soon as Paystack confirms it." };
  }

  let events: WalletEvent[] = [];
  const result = await platformQuery(async (query): Promise<PurchaseSettlement & { amount?: number; currency?: string; balance?: number; by?: string }> => {
    const [purchase] = await query<PurchaseRow>(`SELECT id, tenant_id, package_name, coins, bonus_coins, amount::float8 AS amount, currency, status, reference, initiated_by, initiated_by_name FROM ai_coin_purchases WHERE reference = $1 FOR UPDATE`, [reference]);
    if (purchase.status === "SUCCESS" || purchase.status === "REFUNDED") return { outcome: "already", tenantId: purchase.tenant_id, reference, message: "These coins were already added to your wallet." };
    if (verified.status === "pending") return { outcome: "pending", tenantId: purchase.tenant_id, reference, message: "The payment is not finished yet." };
    if (verified.status !== "success") {
      const status = verified.status === "abandoned" ? "ABANDONED" : "FAILED";
      await query(`UPDATE ai_coin_purchases SET status = $1, failure_reason = $2, settled_by = $3, updated_at = now() WHERE id = $4`, [status, (verified.failureReason ?? verified.status).slice(0, 300), source, purchase.id]);
      return { outcome: "failed", tenantId: purchase.tenant_id, reference, message: verified.status === "abandoned" ? "The payment was not completed." : `The payment failed: ${verified.failureReason ?? "declined"}.`, amount: Number(purchase.amount), currency: purchase.currency };
    }
    const expectedMinor = toMinorUnits(Number(purchase.amount));
    if (verified.reference !== reference || verified.currency !== purchase.currency || verified.amountMinor !== expectedMinor) {
      const reason = `Verification mismatch: Paystack reported ${verified.currency} ${verified.amountMinor / 100} for ${verified.reference}, expected ${purchase.currency} ${expectedMinor / 100}`;
      await query(`UPDATE ai_coin_purchases SET status = 'FAILED', failure_reason = $1, settled_by = $2, updated_at = now() WHERE id = $3`, [reason, source, purchase.id]);
      return { outcome: "rejected", tenantId: purchase.tenant_id, reference, message: "The payment did not match the coin package and no coins were added. Web365 has been alerted." };
    }
    // Credit the wallet: the purchase id is the idempotency key, so this can only ever happen once.
    events = (await ensureWallet(query, purchase.tenant_id)).events;
    const by = { id: purchase.initiated_by, name: purchase.initiated_by_name };
    const credit = await postEntry(query, { tenantId: purchase.tenant_id, type: "PURCHASE", availableDelta: Number(purchase.coins), idempotencyKey: `purchase:${purchase.id}`, description: `${purchase.package_name} package: ${Number(purchase.coins).toLocaleString("en-NG")} coins (${purchase.currency} ${Number(purchase.amount).toLocaleString("en-NG")})`, relatedType: "CoinPurchase", relatedId: purchase.id, by });
    events.push(...credit.events);
    let balance = credit.wallet.available;
    if (Number(purchase.bonus_coins) > 0) {
      const bonus = await postEntry(query, { tenantId: purchase.tenant_id, type: "PROMO_BONUS", availableDelta: Number(purchase.bonus_coins), idempotencyKey: `purchase-bonus:${purchase.id}`, description: `Promotional bonus with the ${purchase.package_name} package`, relatedType: "CoinPurchase", relatedId: purchase.id, by });
      balance = bonus.wallet.available;
    }
    const fees = typeof verified.feesMinor === "number" ? verified.feesMinor / 100 : null;
    await query(
      `UPDATE ai_coin_purchases SET status = 'SUCCESS', paid_at = $1, credited_at = now(), provider_transaction_id = $2, channel = $3, fees = $4, settled_by = $5, failure_reason = NULL, updated_at = now() WHERE id = $6`,
      [verified.paidAt ? new Date(verified.paidAt) : new Date(), verified.transactionId, verified.channel, fees, source, purchase.id],
    );
    return { outcome: "credited", tenantId: purchase.tenant_id, reference, message: `Payment received. ${(Number(purchase.coins) + Number(purchase.bonus_coins)).toLocaleString("en-NG")} coins were added to your AI Wallet.`, coins: Number(purchase.coins) + Number(purchase.bonus_coins), amount: Number(purchase.amount), currency: purchase.currency, balance, by: purchase.initiated_by_name };
  });

  if (result.tenantId && ["credited", "failed", "rejected"].includes(result.outcome)) {
    const amount = `${result.currency ?? "NGN"} ${Number(result.amount ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
    const summary = result.outcome === "credited" ? `AI coin purchase ${reference} confirmed (${source}): ${result.coins} coins for ${amount}` : `AI coin purchase ${reference} ${result.outcome} (${source}): ${result.message}`;
    const severity = result.outcome === "rejected" ? "critical" : result.outcome === "failed" ? "warning" : "info";
    await runInTenant(result.tenantId, () => withDatabaseTransaction(() => {
      recordAudit({ id: "system:billing", name: "AI Wallet", role: "SUPER_ADMIN" }, { action: `ai.purchase-${result.outcome}`, entity: "AICoinPurchase", entityId: reference, summary, severity });
    })).catch((error) => console.error("[ai-coins] tenant audit failed", error));
    await recordPlatformAudit({ id: null, name: "AI Wallet", type: "system" }, { action: `ai.purchase-${result.outcome}`, targetType: "AICoinPurchase", targetId: reference, tenantId: result.tenantId, summary, severity });
    if (result.outcome === "credited") {
      await notifyPharmacy(result.tenantId, [{ title: `${result.coins?.toLocaleString("en-NG")} AI coins added`, body: `Your coin purchase (${amount}) was confirmed. Balance: ${result.balance?.toLocaleString("en-NG")} coins.`, audience: "ai.wallet.view" }]);
      sendOwnerEmail(result.tenantId, "ai_coins_credited", { coins: result.coins?.toLocaleString("en-NG"), reason: "coin purchase", balance: result.balance?.toLocaleString("en-NG"), amount, reference });
      await deliverWalletEvents(result.tenantId, events);
    } else if (result.outcome === "failed") {
      await notifyPharmacy(result.tenantId, [{ title: "AI coin purchase did not go through", body: `${result.message} No coins were added.`, severity: "warning", audience: "ai.coins.purchase" }]);
      sendOwnerEmail(result.tenantId, "ai_purchase_failed", { amount, reason: result.message.replace(/^The payment (failed: )?/, "").replace(/\.$/, "") });
    }
  }
  return { outcome: result.outcome, tenantId: result.tenantId, reference: result.reference, message: result.message, coins: result.coins };
}

/** Re-checks purchases still pending (payment finished but not yet confirmed, or credit interrupted). */
export async function reconcilePendingPurchases(olderThanMinutes = 5) {
  const pending = await platformQuery((query) =>
    query<{ reference: string }>(`SELECT reference FROM ai_coin_purchases WHERE status = 'PENDING' AND created_at < now() - ($1 || ' minutes')::interval AND created_at > now() - interval '30 days' ORDER BY created_at LIMIT 100`, [String(olderThanMinutes)]),
  );
  const results: PurchaseSettlement[] = [];
  for (const { reference } of pending) results.push(await settleCoinPurchase(reference, "reconciliation"));
  return results;
}

/**
 * Refunds a coin purchase (platform staff): only while the pharmacy still holds all of those coins. The
 * money goes back through Paystack first; the coins are then removed with a reversing ledger entry.
 */
export async function refundCoinPurchase(actor: PlatformActor, purchaseId: string, reason: string) {
  if (reason.trim().length < 10) throw new DomainError("Explain the refund (at least 10 characters).");
  const [purchase] = await platformQuery((query) => query<PurchaseRow & { provider_transaction_id: string | null }>(`SELECT id, tenant_id, package_name, coins, bonus_coins, amount::float8 AS amount, currency, status, reference FROM ai_coin_purchases WHERE id = $1`, [purchaseId]));
  if (!purchase) throw new DomainError("Purchase not found.", 404);
  if (purchase.status !== "SUCCESS") throw new DomainError("Only completed purchases can be refunded.", 409);
  const coins = Number(purchase.coins) + Number(purchase.bonus_coins);
  const wallet = await platformQuery((query) => walletFor(query, purchase.tenant_id));
  if (!wallet || wallet.available < coins) throw new DomainError(`The pharmacy has used some of these coins (${wallet?.available ?? 0} available, ${coins} bought). Refund by hand and record a manual adjustment instead.`, 409);
  await billingProvider().refund({ reference: purchase.reference, amountMinor: toMinorUnits(Number(purchase.amount)), currency: purchase.currency, note: `AI coins refund: ${reason.trim()}` });
  await platformQuery(async (query) => {
    await postEntry(query, { tenantId: purchase.tenant_id, type: "PURCHASE_REVERSAL", availableDelta: -coins, idempotencyKey: `reversal:${purchase.id}`, description: `Purchase ${purchase.reference} refunded: ${reason.trim()}`.slice(0, 300), relatedType: "CoinPurchase", relatedId: purchase.id, by: { id: actor.id, name: `${actor.name} (Web365)` } });
    await query(`UPDATE ai_coin_purchases SET status = 'REFUNDED', refunded_at = now(), updated_at = now() WHERE id = $1`, [purchase.id]);
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.purchase-refunded", targetType: "AICoinPurchase", targetId: purchase.reference, tenantId: purchase.tenant_id, summary: `Refunded AI coin purchase ${purchase.reference} (${coins} coins): ${reason.trim()}`, severity: "warning" });
  await notifyPharmacy(purchase.tenant_id, [{ title: "AI coin purchase refunded", body: `Purchase ${purchase.reference} was refunded and its ${coins} coins removed from your wallet.`, severity: "warning", audience: "ai.wallet.view" }]);
  return { ok: true };
}
