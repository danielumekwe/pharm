// AI Wallet as the pharmacy sees it: balance, transactions, usage by staff and job, prices and packages.
// The pharmacy is always the signed-in actor's own (never a value from the browser).

import { platformQuery } from "@/lib/db/database";
import { assertCan, DomainError } from "@/lib/erp/services";
import type { Actor } from "@/lib/erp/types";
import { can, canAny } from "@/lib/rbac";
import { runInTenant } from "@/lib/saas/tenant";
import { withDatabaseTransaction } from "@/lib/db/database";

import { deliverWalletEvents } from "./notify";
import { packagesForSale } from "./purchases";
import { PAGE_CODES } from "./scan-billing";
import { currentPrices, ensureWallet, TRANSACTION_LABELS, type TransactionType } from "./wallet";

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);

function tenantOf(actor: Actor) {
  if (!actor.tenantId) throw new DomainError("No pharmacy selected.", 401);
  return actor.tenantId;
}

function assertViewer(actor: Actor) {
  if (!canAny(actor, ["ai.wallet.view", "ai.usage.view", "ai.coins.purchase", "ai.wallet.manage"])) assertCan(actor, "ai.wallet.view");
}

/** Opens a new pharmacy's wallet (with the welcome bonus, when the promotion is on). */
export async function openWalletForNewPharmacy(tenantId: string) {
  const { events } = await platformQuery((query) => ensureWallet(query, tenantId));
  if (events.length) await runInTenant(tenantId, () => withDatabaseTransaction(() => deliverWalletEvents(tenantId, events)));
}

export async function walletOverview(actor: Actor) {
  assertViewer(actor);
  const tenantId = tenantOf(actor);
  const { wallet, events } = await platformQuery((query) => ensureWallet(query, tenantId));
  await deliverWalletEvents(tenantId, events);
  const [prices, packages, purchases] = await platformQuery(async (query) => [
    await currentPrices(query, tenantId),
    await packagesForSale(query),
    can(actor, "ai.coins.purchase") || can(actor, "ai.wallet.manage")
      ? await query<Record<string, unknown>>(`SELECT reference, package_name, coins, bonus_coins, amount::float8 AS amount, currency, status, failure_reason, initiated_by_name, created_at, credited_at FROM ai_coin_purchases WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20`, [tenantId])
      : [],
  ] as const);
  return {
    wallet: { available: wallet.available, reserved: wallet.reserved, purchasedTotal: wallet.purchasedTotal, freeTotal: wallet.freeTotal, consumedTotal: wallet.consumedTotal, refundedTotal: wallet.refundedTotal, status: wallet.status, createdAt: wallet.createdAt, lastTransactionAt: wallet.lastTransactionAt },
    prices: [...prices.values()]
      .filter((price) => price.enabled)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((price) => ({ code: price.code, name: price.name, description: price.description, method: price.method, coins: price.coins, override: price.tenantId !== null })),
    scanPrices: Object.fromEntries(Object.entries(PAGE_CODES).map(([key, code]) => [key, prices.get(code)?.enabled ? prices.get(code)!.coins : 0])),
    packages: packages.map(({ id, name, description, coins, bonusCoins, totalCoins, price, currency, promoEndsAt }) => ({ id, name, description, coins, bonusCoins, totalCoins, price, currency, promoEndsAt })),
    purchases: purchases.map((row) => ({ reference: String(row.reference), packageName: String(row.package_name), coins: Number(row.coins) + Number(row.bonus_coins), amount: Number(row.amount), currency: String(row.currency), status: String(row.status), failureReason: (row.failure_reason as string | null) ?? null, by: String(row.initiated_by_name), createdAt: iso(row.created_at), creditedAt: iso(row.credited_at) })),
    permissions: { view: can(actor, "ai.wallet.view"), usage: can(actor, "ai.usage.view"), purchase: can(actor, "ai.coins.purchase"), manage: can(actor, "ai.wallet.manage") },
  };
}

const TYPES = Object.keys(TRANSACTION_LABELS) as TransactionType[];

export async function walletTransactions(actor: Actor, filters: { type?: string | null; from?: string | null; to?: string | null; page?: number; pageSize?: number }) {
  if (!can(actor, "ai.wallet.view") && !can(actor, "ai.wallet.manage")) assertCan(actor, "ai.wallet.view");
  const tenantId = tenantOf(actor);
  const pageSize = Math.min(100, Math.max(5, Math.trunc(filters.pageSize ?? 25)));
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const where = ["tenant_id = $1"];
  const params: unknown[] = [tenantId];
  if (filters.type && TYPES.includes(filters.type as TransactionType)) {
    params.push(filters.type);
    where.push(`type = $${params.length}`);
  }
  const date = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  if (date(filters.from)) {
    params.push(date(filters.from));
    where.push(`created_at >= $${params.length}::date`);
  }
  if (date(filters.to)) {
    params.push(date(filters.to));
    where.push(`created_at < ($${params.length}::date + 1)`);
  }
  const [rows, [{ total }]] = await platformQuery(async (query) => [
    await query<Record<string, unknown>>(
      `SELECT id, reference, type, direction, amount, available_delta, reserved_delta, available_after, reserved_after, related_type, related_id, operation_code, description, created_by_name, created_at
         FROM ai_wallet_transactions WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    ),
    await query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ai_wallet_transactions WHERE ${where.join(" AND ")}`, params),
  ] as const);
  return {
    page,
    pageSize,
    total,
    types: TYPES.map((type) => ({ value: type, label: TRANSACTION_LABELS[type] })),
    rows: rows.map((row) => {
      const available = Number(row.available_delta);
      return {
        id: String(row.id),
        reference: String(row.reference),
        type: String(row.type),
        typeLabel: TRANSACTION_LABELS[row.type as TransactionType] ?? String(row.type),
        description: String(row.description),
        // Credits and debits of spendable coins; reservations move coins between available and reserved.
        credited: available > 0 ? available : 0,
        debited: available < 0 ? -available : row.type === "AI_USAGE" ? Number(row.amount) : 0,
        amount: Number(row.amount),
        direction: String(row.direction),
        balanceAfter: Number(row.available_after),
        reservedAfter: Number(row.reserved_after),
        operation: (row.operation_code as string | null) ?? null,
        related: row.related_type ? { type: String(row.related_type), id: String(row.related_id ?? "") } : null,
        by: String(row.created_by_name),
        status: "Completed",
        at: iso(row.created_at),
      };
    }),
  };
}

export async function walletUsage(actor: Actor, filters: { from?: string | null; to?: string | null }) {
  if (!can(actor, "ai.usage.view") && !can(actor, "ai.wallet.manage")) assertCan(actor, "ai.usage.view");
  const tenantId = tenantOf(actor);
  const from = filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from) ? filters.from : new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? filters.to : new Date().toISOString().slice(0, 10);
  const range = `tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + 1)`;
  const params = [tenantId, from, to];
  const [byStaff, byJob, byOperation, daily] = await platformQuery(async (query) => [
    await query<Record<string, unknown>>(`SELECT COALESCE(user_name, 'System') AS name, COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS pages, COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed, COALESCE(SUM(coins_charged), 0)::int AS coins FROM ai_usage WHERE ${range} GROUP BY 1 ORDER BY coins DESC`, params),
    await query<Record<string, unknown>>(`SELECT job_id, job_reference, COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS pages, COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed, COALESCE(SUM(coins_charged), 0)::int AS coins, MAX(created_at) AS last FROM ai_usage WHERE ${range} GROUP BY 1, 2 ORDER BY last DESC LIMIT 50`, params),
    await query<Record<string, unknown>>(`SELECT COALESCE(operation_code, 'other') AS code, COUNT(*)::int AS requests, COALESCE(SUM(coins_charged), 0)::int AS coins FROM ai_usage WHERE ${range} GROUP BY 1 ORDER BY coins DESC`, params),
    await query<Record<string, unknown>>(`SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COALESCE(SUM(coins_charged), 0)::int AS coins, COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS pages FROM ai_usage WHERE ${range} GROUP BY 1 ORDER BY 1`, params),
  ] as const);
  return {
    from,
    to,
    byStaff: byStaff.map((row) => ({ name: String(row.name), pages: Number(row.pages), failed: Number(row.failed), coins: Number(row.coins) })),
    byJob: byJob.map((row) => ({ jobId: (row.job_id as string | null) ?? null, reference: (row.job_reference as string | null) ?? "—", pages: Number(row.pages), failed: Number(row.failed), coins: Number(row.coins), last: iso(row.last) })),
    byOperation: byOperation.map((row) => ({ code: String(row.code), requests: Number(row.requests), coins: Number(row.coins) })),
    daily: daily.map((row) => ({ day: String(row.day), coins: Number(row.coins), pages: Number(row.pages) })),
  };
}
