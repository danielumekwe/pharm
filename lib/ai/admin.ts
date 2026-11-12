// Control Centre → AI Usage & Billing. Every figure comes from the database (ledger, purchases, provider
// usage); nothing is estimated except provider cost, which is labelled as an estimate from token counts and
// the configured model prices. No document content is read here: only coins, money, counts and references.
//
// Accounting method (shown on the dashboard):
// - Revenue: cash received for coins (successful purchases, less refunds), on the payment date. Free coins
//   (welcome and promotional bonuses) are not revenue.
// - Payment fees: the provider fee Paystack reported for each purchase.
// - AI expenditure: estimated provider cost of the AI requests made in the period (success and failure),
//   converted to naira at the configured USD→NGN rate. Unused coin balances are not expenditure.
// - Gross profit = revenue − payment fees − AI expenditure (naira). Margin = gross profit ÷ revenue.

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { describePlatformSetting, readPlatformSetting, updatePlatformSetting } from "@/lib/platform/settings";

import { notifyPharmacy } from "./notify";
import { refundCoinPurchase, settleCoinPurchase } from "./purchases";
import { reconcileAi } from "./reconcile";
import { ensureWallet, limitsFor, postEntry, TRANSACTION_LABELS, type TransactionType } from "./wallet";

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);
const day = (value: string | null | undefined, fallback: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback);

export function range(input: { from?: string | null; to?: string | null }) {
  const to = day(input.to, new Date().toISOString().slice(0, 10));
  const from = day(input.from, new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  return { from, to };
}

// ---------------------------------------------------------------- dashboard

export async function aiDashboard(input: { from?: string | null; to?: string | null }) {
  const { from, to } = range(input);
  const { value: config } = await readPlatformSetting("ai.wallet");
  const window = `created_at >= $1::date AND created_at < ($2::date + 1)`;
  return platformQuery(async (query) => {
    const [ledger] = await query<Record<string, number>>(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'PURCHASE'), 0)::int AS purchased,
              COALESCE(SUM(amount) FILTER (WHERE type IN ('WELCOME_BONUS', 'PROMO_BONUS')), 0)::int AS free,
              COALESCE(SUM(amount) FILTER (WHERE type = 'AI_USAGE'), 0)::int AS consumed,
              COALESCE(SUM(available_delta) FILTER (WHERE type IN ('PURCHASE', 'WELCOME_BONUS', 'PROMO_BONUS', 'REFUND') OR (type = 'ADJUSTMENT' AND available_delta > 0)), 0)::int AS issued,
              COALESCE(SUM(amount) FILTER (WHERE type = 'REFUND'), 0)::int AS refunded
         FROM ai_wallet_transactions WHERE ${window}`,
      [from, to],
    );
    const [balances] = await query<Record<string, number>>(`SELECT COALESCE(SUM(available), 0)::int AS available, COALESCE(SUM(reserved), 0)::int AS reserved, COUNT(*)::int AS wallets FROM ai_wallets`);
    const [usage] = await query<Record<string, number>>(
      `SELECT COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS success, COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
              COUNT(DISTINCT job_id) FILTER (WHERE status = 'SUCCESS')::int AS jobs,
              COALESCE(SUM(cost), 0)::float8 AS cost, COALESCE(SUM(cost) FILTER (WHERE status = 'FAILED'), 0)::float8 AS failed_cost,
              COUNT(*) FILTER (WHERE cost_basis = 'unavailable')::int AS unpriced
         FROM ai_usage WHERE ${window}`,
      [from, to],
    );
    const [money] = await query<Record<string, number>>(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status IN ('SUCCESS', 'REFUNDED')), 0)::float8 AS gross, COALESCE(SUM(amount) FILTER (WHERE status = 'REFUNDED'), 0)::float8 AS refunds,
              COALESCE(SUM(fees) FILTER (WHERE status IN ('SUCCESS', 'REFUNDED')), 0)::float8 AS fees, COUNT(*) FILTER (WHERE status IN ('SUCCESS', 'REFUNDED'))::int AS purchases,
              COUNT(*) FILTER (WHERE status IN ('SUCCESS', 'REFUNDED') AND fees IS NULL)::int AS fees_unknown
         FROM ai_coin_purchases WHERE COALESCE(paid_at, created_at) >= $1::date AND COALESCE(paid_at, created_at) < ($2::date + 1)`,
      [from, to],
    );
    const series = await query<Record<string, unknown>>(
      `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d)
       SELECT to_char(d, 'YYYY-MM-DD') AS day,
              COALESCE((SELECT SUM(amount) FROM ai_wallet_transactions WHERE type = 'AI_USAGE' AND created_at::date = d), 0)::int AS coins,
              COALESCE((SELECT SUM(cost) FROM ai_usage WHERE created_at::date = d), 0)::float8 AS cost,
              COALESCE((SELECT SUM(amount) FROM ai_coin_purchases WHERE status = 'SUCCESS' AND COALESCE(paid_at, created_at)::date = d), 0)::float8 AS revenue
         FROM days ORDER BY d`,
      [from, to],
    );
    const byTenant = await query<Record<string, unknown>>(
      `SELECT u.tenant_id, t.name, COALESCE(SUM(u.coins_charged), 0)::int AS coins, COALESCE(SUM(u.cost), 0)::float8 AS cost, COUNT(*) FILTER (WHERE u.status = 'SUCCESS')::int AS pages
         FROM ai_usage u JOIN tenants t ON t.id = u.tenant_id WHERE u.created_at >= $1::date AND u.created_at < ($2::date + 1) GROUP BY 1, 2 ORDER BY coins DESC, cost DESC LIMIT 10`,
      [from, to],
    );
    const byOperation = await query<Record<string, unknown>>(
      `SELECT COALESCE(operation_code, 'unknown') AS code, COUNT(*)::int AS requests, COALESCE(SUM(coins_charged), 0)::int AS coins, COALESCE(SUM(cost), 0)::float8 AS cost FROM ai_usage WHERE ${window} GROUP BY 1 ORDER BY coins DESC`,
      [from, to],
    );
    const revenue = Number(money.gross) - Number(money.refunds);
    const rate = config.usdToNgnRate;
    const costNgn = rate ? Number(usage.cost) * rate : null;
    const grossProfit = costNgn === null ? null : revenue - Number(money.fees) - costNgn;
    return {
      from,
      to,
      coins: { issued: ledger.issued, purchased: ledger.purchased, free: ledger.free, consumed: ledger.consumed, refunded: ledger.refunded, reservedNow: balances.reserved, availableNow: balances.available, wallets: balances.wallets },
      jobs: { successfulRequests: usage.success, failedRequests: usage.failed, jobs: usage.jobs },
      provider: { cost: Number(usage.cost), currency: "USD", failedCost: Number(usage.failed_cost), unpricedRequests: usage.unpriced, basis: "Estimated from reported tokens × configured model prices" },
      money: {
        currency: "NGN",
        revenue,
        refunds: Number(money.refunds),
        purchases: money.purchases,
        fees: Number(money.fees),
        feesUnknown: money.fees_unknown,
        usdToNgnRate: rate,
        costNgn,
        grossProfit,
        grossMargin: grossProfit === null || revenue <= 0 ? null : grossProfit / revenue,
        costPerPage: usage.success ? Number(usage.cost) / usage.success : null,
        revenuePerPage: usage.success ? revenue / usage.success : null,
        coinValue: config.ngnPerCoin ? { ngnPerCoin: config.ngnPerCoin, consumedValue: ledger.consumed * config.ngnPerCoin, freeValue: ledger.free * config.ngnPerCoin } : null,
      },
      series: series.map((row) => ({ day: String(row.day), coins: Number(row.coins), cost: Number(row.cost), revenue: Number(row.revenue) })),
      byTenant: byTenant.map((row) => ({ tenantId: String(row.tenant_id), name: String(row.name), coins: Number(row.coins), cost: Number(row.cost), pages: Number(row.pages) })),
      byOperation: byOperation.map((row) => ({ code: String(row.code), requests: Number(row.requests), coins: Number(row.coins), cost: Number(row.cost) })),
    };
  });
}

// ---------------------------------------------------------------- provider costs

export async function providerCosts(input: { from?: string | null; to?: string | null }) {
  const { from, to } = range(input);
  const window = `u.created_at >= $1::date AND u.created_at < ($2::date + 1)`;
  return platformQuery(async (query) => {
    const group = (by: string, extra = "") =>
      query<Record<string, unknown>>(
        `SELECT ${by} AS key${extra}, COUNT(*)::int AS requests, COUNT(*) FILTER (WHERE u.status = 'SUCCESS')::int AS success, COUNT(*) FILTER (WHERE u.status = 'FAILED')::int AS failed,
                COALESCE(SUM(u.input_tokens), 0)::float8 AS input_tokens, COALESCE(SUM(u.output_tokens), 0)::float8 AS output_tokens, COALESCE(SUM(u.cost), 0)::float8 AS cost,
                COALESCE(SUM(u.cost) FILTER (WHERE u.status = 'FAILED'), 0)::float8 AS failed_cost, COUNT(*) FILTER (WHERE u.cost_basis = 'unavailable')::int AS unpriced
           FROM ai_usage u ${extra.includes("t.") ? "JOIN tenants t ON t.id = u.tenant_id" : ""} WHERE ${window} GROUP BY 1${extra ? ", 2" : ""} ORDER BY cost DESC LIMIT 100`,
        [from, to],
      );
    const shape = (rows: Record<string, unknown>[]) =>
      rows.map((row) => ({ key: String(row.key), label: row.label ? String(row.label) : String(row.key), requests: Number(row.requests), success: Number(row.success), failed: Number(row.failed), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), cost: Number(row.cost), failedCost: Number(row.failed_cost), unpriced: Number(row.unpriced), costPerPage: Number(row.success) ? Number(row.cost) / Number(row.success) : null }));
    const monthly = await query<Record<string, unknown>>(`SELECT to_char(created_at, 'YYYY-MM') AS month, COALESCE(SUM(cost), 0)::float8 AS cost, COUNT(*)::int AS requests FROM ai_usage GROUP BY 1 ORDER BY 1 DESC LIMIT 12`);
    const recent = await query<Record<string, unknown>>(
      `SELECT u.created_at, t.name AS tenant, u.provider, u.model, u.operation_code, u.job_reference, u.request_id, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_creation_tokens, u.cost::float8 AS cost, u.cost_basis, u.duration_ms, u.status, u.attempt, u.error, u.model_price_id
         FROM ai_usage u JOIN tenants t ON t.id = u.tenant_id WHERE ${window} ORDER BY u.created_at DESC LIMIT 100`,
      [from, to],
    );
    return {
      from,
      to,
      currency: "USD",
      basis: "Estimated: tokens reported by the provider × the configured model price in force. Not a provider invoice.",
      byModel: shape(await group("u.model")),
      byTenant: shape(await group("u.tenant_id", ", t.name AS label")),
      byOperation: shape(await group("COALESCE(u.operation_code, 'unknown')")),
      daily: shape(await group("to_char(u.created_at, 'YYYY-MM-DD')")).sort((a, b) => a.key.localeCompare(b.key)),
      monthly: monthly.map((row) => ({ month: String(row.month), cost: Number(row.cost), requests: Number(row.requests) })),
      recent: recent.map((row) => ({
        at: iso(row.created_at), tenant: String(row.tenant), provider: String(row.provider), model: String(row.model), operation: (row.operation_code as string | null) ?? null, job: (row.job_reference as string | null) ?? null, requestId: (row.request_id as string | null) ?? null,
        inputTokens: row.input_tokens === null ? null : Number(row.input_tokens), outputTokens: row.output_tokens === null ? null : Number(row.output_tokens), cacheReadTokens: row.cache_read_tokens === null ? null : Number(row.cache_read_tokens), cacheCreationTokens: row.cache_creation_tokens === null ? null : Number(row.cache_creation_tokens),
        cost: row.cost === null ? null : Number(row.cost), basis: String(row.cost_basis), pricingVersion: (row.model_price_id as string | null) ?? null, durationMs: row.duration_ms === null ? null : Number(row.duration_ms), status: String(row.status), attempt: Number(row.attempt), error: (row.error as string | null) ?? null,
      })),
    };
  });
}

// ---------------------------------------------------------------- prices

export async function pricingView() {
  return platformQuery(async (query) => {
    const operations = await query<Record<string, unknown>>(`SELECT p.*, t.name AS tenant_name FROM ai_operation_prices p LEFT JOIN tenants t ON t.id = p.tenant_id ORDER BY p.code, p.tenant_id NULLS FIRST, p.effective_from DESC`);
    const models = await query<Record<string, unknown>>(`SELECT id, provider, model, input_per_mtok::float8 AS input, output_per_mtok::float8 AS output, cache_read_per_mtok::float8 AS cache_read, cache_write_per_mtok::float8 AS cache_write, currency, source, effective_from, effective_to, created_by FROM ai_model_prices ORDER BY provider, model, effective_from DESC`);
    return {
      operations: operations.map((row) => ({ id: String(row.id), code: String(row.code), tenantId: (row.tenant_id as string | null) ?? null, tenantName: (row.tenant_name as string | null) ?? null, name: String(row.name), description: String(row.description), method: String(row.method), coins: Number(row.coins), enabled: Boolean(row.enabled), effectiveFrom: iso(row.effective_from), effectiveTo: iso(row.effective_to), createdBy: String(row.created_by), current: row.effective_to === null })),
      models: models.map((row) => ({ id: String(row.id), provider: String(row.provider), model: String(row.model), input: Number(row.input), output: Number(row.output), cacheRead: Number(row.cache_read), cacheWrite: Number(row.cache_write), currency: String(row.currency), source: String(row.source), effectiveFrom: iso(row.effective_from), effectiveTo: iso(row.effective_to), createdBy: String(row.created_by), current: row.effective_to === null })),
    };
  });
}

const priceSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{2,60}$/, "Use lower-case letters, digits, dots and dashes"),
  tenantId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).default(""),
  method: z.enum(["FIXED", "PER_PAGE", "PER_DOCUMENT", "PER_1K_TOKENS"]),
  coins: z.number().int().min(0).max(1_000_000),
  enabled: z.boolean(),
});

/** A new price from now on; the previous one is kept (ended), so earlier reservations and charges keep theirs. */
export async function setOperationPrice(actor: PlatformActor, input: unknown) {
  const data = priceSchema.parse(input);
  const tenantId = data.tenantId ?? null;
  await platformQuery(async (query) => {
    if (tenantId) {
      const [tenant] = await query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1`, [tenantId]);
      if (!tenant) throw new DomainError("Pharmacy not found.", 404);
    }
    await query(`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('ai-price:' || $1::text || ':' || $2::text))`, [data.code, tenantId ?? ""]);
    await query(`UPDATE ai_operation_prices SET effective_to = now() WHERE code = $1 AND tenant_id IS NOT DISTINCT FROM $2::text AND effective_to IS NULL`, [data.code, tenantId]);
    await query(`INSERT INTO ai_operation_prices (id, code, tenant_id, name, description, method, coins, enabled, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [`aop-${randomUUID()}`, data.code, tenantId, data.name, data.description, data.method, data.coins, data.enabled, actor.name]);
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.price", targetType: "AIOperationPrice", targetId: data.code, tenantId, summary: `${data.name} (${data.code})${tenantId ? ` for one pharmacy` : ""}: ${data.coins} coins ${data.method.toLowerCase().replace(/_/g, " ")}, ${data.enabled ? "enabled" : "disabled"} — applies to new work from now`, severity: "warning" });
  return pricingView();
}

/** Removes a pharmacy's price override (it returns to the standard price). */
export async function endPriceOverride(actor: PlatformActor, code: string, tenantId: string) {
  await platformQuery((query) => query(`UPDATE ai_operation_prices SET effective_to = now() WHERE code = $1 AND tenant_id = $2 AND effective_to IS NULL`, [code, tenantId]));
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.price-override-ended", targetType: "AIOperationPrice", targetId: code, tenantId, summary: `Price override for ${code} removed` });
  return pricingView();
}

const modelSchema = z.object({
  provider: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  model: z.string().trim().regex(/^[a-z0-9.-]{2,80}$/),
  input: z.number().min(0).max(10_000),
  output: z.number().min(0).max(10_000),
  cacheRead: z.number().min(0).max(10_000),
  cacheWrite: z.number().min(0).max(10_000),
  source: z.string().trim().max(200).default(""),
});

export async function setModelPrice(actor: PlatformActor, input: unknown) {
  const data = modelSchema.parse(input);
  await platformQuery(async (query) => {
    await query(`UPDATE ai_model_prices SET effective_to = now() WHERE provider = $1 AND model = $2 AND effective_to IS NULL`, [data.provider, data.model]);
    await query(`INSERT INTO ai_model_prices (id, provider, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, source, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [`amp-${randomUUID()}`, data.provider, data.model, data.input, data.output, data.cacheRead, data.cacheWrite, data.source, actor.name]);
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.model-price", targetType: "AIModelPrice", targetId: `${data.provider}/${data.model}`, summary: `${data.model}: $${data.input} in / $${data.output} out per million tokens (cache read $${data.cacheRead}, write $${data.cacheWrite}) from now`, severity: "warning" });
  return pricingView();
}

// ---------------------------------------------------------------- packages

export async function listPackages() {
  const rows = await platformQuery((query) => query<Record<string, unknown>>(`SELECT p.*, p.price::float8 AS price_value, (SELECT COUNT(*)::int FROM ai_coin_purchases c WHERE c.package_id = p.id AND c.status = 'SUCCESS') AS sold FROM ai_coin_packages p ORDER BY display_order, price`));
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name), description: String(row.description), coins: Number(row.coins), bonusCoins: Number(row.bonus_coins), price: Number(row.price_value), currency: String(row.currency), active: Boolean(row.active),
    displayOrder: Number(row.display_order), promoStartsAt: iso(row.promo_starts_at), promoEndsAt: iso(row.promo_ends_at), maxPerTenantPerMonth: row.max_per_tenant_per_month === null ? null : Number(row.max_per_tenant_per_month), sold: Number(row.sold), updatedAt: iso(row.updated_at),
  }));
}

const packageSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).default(""),
  coins: z.number().int().min(1).max(10_000_000),
  bonusCoins: z.number().int().min(0).max(10_000_000),
  price: z.number().positive().max(100_000_000),
  active: z.boolean(),
  displayOrder: z.number().int().min(0).max(1000),
  promoStartsAt: z.string().datetime({ offset: true }).nullable().or(z.literal("").transform(() => null)).optional(),
  promoEndsAt: z.string().datetime({ offset: true }).nullable().or(z.literal("").transform(() => null)).optional(),
  maxPerTenantPerMonth: z.number().int().min(1).max(1000).nullable(),
});

/** Creates or edits a package. Purchases already started keep the package as it was when they started. */
export async function savePackage(actor: PlatformActor, input: unknown) {
  const data = packageSchema.parse(input);
  if (data.promoStartsAt && data.promoEndsAt && data.promoStartsAt >= data.promoEndsAt) throw new DomainError("The promotion must end after it starts.");
  const id = data.id ?? `acp-${randomUUID()}`;
  await platformQuery(async (query) => {
    if (data.id) {
      const [existing] = await query<{ id: string }>(`SELECT id FROM ai_coin_packages WHERE id = $1`, [data.id]);
      if (!existing) throw new DomainError("Package not found.", 404);
      await query(
        `UPDATE ai_coin_packages SET name = $1, description = $2, coins = $3, bonus_coins = $4, price = $5, active = $6, display_order = $7, promo_starts_at = $8, promo_ends_at = $9, max_per_tenant_per_month = $10, updated_at = now(), updated_by = $11 WHERE id = $12`,
        [data.name, data.description, data.coins, data.bonusCoins, data.price, data.active, data.displayOrder, data.promoStartsAt ?? null, data.promoEndsAt ?? null, data.maxPerTenantPerMonth, actor.name, id],
      );
    } else {
      await query(
        `INSERT INTO ai_coin_packages (id, name, description, coins, bonus_coins, price, active, display_order, promo_starts_at, promo_ends_at, max_per_tenant_per_month, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, data.name, data.description, data.coins, data.bonusCoins, data.price, data.active, data.displayOrder, data.promoStartsAt ?? null, data.promoEndsAt ?? null, data.maxPerTenantPerMonth, actor.name],
      );
    }
  });
  await recordPlatformAudit(platformActorRef(actor), { action: data.id ? "ai.package-update" : "ai.package-create", targetType: "AICoinPackage", targetId: id, summary: `${data.name}: ${data.coins} coins${data.bonusCoins ? ` + ${data.bonusCoins} bonus` : ""} for ₦${data.price.toLocaleString("en-NG")}, ${data.active ? "on sale" : "not on sale"}`, severity: "warning" });
  return listPackages();
}

// ---------------------------------------------------------------- pharmacies

export async function tenantUsage() {
  const rows = await platformQuery((query) =>
    query<Record<string, unknown>>(
      `SELECT t.id, t.name, t.status, t.is_demo, w.available, w.reserved, w.purchased_total, w.free_total, w.consumed_total, w.status AS wallet_status,
              (SELECT COUNT(DISTINCT job_id)::int FROM ai_usage u WHERE u.tenant_id = t.id) AS jobs,
              (SELECT COALESCE(SUM(cost), 0)::float8 FROM ai_usage u WHERE u.tenant_id = t.id) AS cost,
              (SELECT MAX(created_at) FROM ai_usage u WHERE u.tenant_id = t.id) AS last_activity,
              (SELECT COALESCE(SUM(amount), 0)::float8 FROM ai_coin_purchases c WHERE c.tenant_id = t.id AND c.status = 'SUCCESS') AS revenue
         FROM tenants t LEFT JOIN ai_wallets w ON w.tenant_id = t.id ORDER BY t.name`,
    ),
  );
  return rows.map((row) => ({
    tenantId: String(row.id), name: String(row.name), status: String(row.status), demo: Boolean(row.is_demo), hasWallet: row.available !== null, walletStatus: (row.wallet_status as string | null) ?? null,
    available: Number(row.available ?? 0), reserved: Number(row.reserved ?? 0), purchased: Number(row.purchased_total ?? 0), free: Number(row.free_total ?? 0), consumed: Number(row.consumed_total ?? 0),
    jobs: Number(row.jobs), cost: Number(row.cost), revenue: Number(row.revenue), lastActivity: iso(row.last_activity),
  }));
}

export async function tenantDetail(tenantId: string) {
  return platformQuery(async (query) => {
    const [tenant] = await query<Record<string, unknown>>(`SELECT id, name, status FROM tenants WHERE id = $1`, [tenantId]);
    if (!tenant) throw new DomainError("Pharmacy not found.", 404);
    const [wallet] = await query<Record<string, unknown>>(`SELECT * FROM ai_wallets WHERE tenant_id = $1`, [tenantId]);
    const transactions = await query<Record<string, unknown>>(`SELECT reference, type, direction, amount, available_after, reserved_after, description, operation_code, created_by_name, created_at FROM ai_wallet_transactions WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 100`, [tenantId]);
    const purchases = await query<Record<string, unknown>>(`SELECT id, reference, package_name, coins, bonus_coins, amount::float8 AS amount, fees::float8 AS fees, currency, status, failure_reason, initiated_by_name, created_at, credited_at FROM ai_coin_purchases WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`, [tenantId]);
    const usage = await query<Record<string, unknown>>(`SELECT COALESCE(operation_code, 'unknown') AS code, COUNT(*)::int AS requests, COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed, COALESCE(SUM(coins_charged), 0)::int AS coins, COALESCE(SUM(cost), 0)::float8 AS cost FROM ai_usage WHERE tenant_id = $1 GROUP BY 1 ORDER BY coins DESC`, [tenantId]);
    const staff = await query<Record<string, unknown>>(`SELECT COALESCE(user_name, 'System') AS name, COUNT(*)::int AS requests, COALESCE(SUM(coins_charged), 0)::int AS coins FROM ai_usage WHERE tenant_id = $1 GROUP BY 1 ORDER BY coins DESC`, [tenantId]);
    const limits = await limitsFor(query, tenantId);
    const overrides = await query<Record<string, unknown>>(`SELECT code, name, coins, enabled, method FROM ai_operation_prices WHERE tenant_id = $1 AND effective_to IS NULL ORDER BY code`, [tenantId]);
    return {
      tenant: { id: String(tenant.id), name: String(tenant.name), status: String(tenant.status) },
      wallet: wallet ? { available: Number(wallet.available), reserved: Number(wallet.reserved), purchased: Number(wallet.purchased_total), free: Number(wallet.free_total), consumed: Number(wallet.consumed_total), refunded: Number(wallet.refunded_total), status: String(wallet.status), createdAt: iso(wallet.created_at), lastTransactionAt: iso(wallet.last_transaction_at) } : null,
      transactions: transactions.map((row) => ({ reference: String(row.reference), type: String(row.type), typeLabel: TRANSACTION_LABELS[row.type as TransactionType] ?? String(row.type), direction: String(row.direction), amount: Number(row.amount), availableAfter: Number(row.available_after), reservedAfter: Number(row.reserved_after), description: String(row.description), operation: (row.operation_code as string | null) ?? null, by: String(row.created_by_name), at: iso(row.created_at) })),
      purchases: purchases.map((row) => ({ id: String(row.id), reference: String(row.reference), packageName: String(row.package_name), coins: Number(row.coins) + Number(row.bonus_coins), amount: Number(row.amount), fees: row.fees === null ? null : Number(row.fees), currency: String(row.currency), status: String(row.status), failureReason: (row.failure_reason as string | null) ?? null, by: String(row.initiated_by_name), createdAt: iso(row.created_at), creditedAt: iso(row.credited_at) })),
      usage: usage.map((row) => ({ code: String(row.code), requests: Number(row.requests), failed: Number(row.failed), coins: Number(row.coins), cost: Number(row.cost) })),
      staff: staff.map((row) => ({ name: String(row.name), requests: Number(row.requests), coins: Number(row.coins) })),
      limits: limits.tenant,
      overrides: overrides.map((row) => ({ code: String(row.code), name: String(row.name), coins: Number(row.coins), enabled: Boolean(row.enabled), method: String(row.method) })),
    };
  });
}

const adjustmentSchema = z.object({
  tenantId: z.string().min(1),
  coins: z.number().int().refine((value) => value !== 0, "Enter a number of coins (negative to remove).").refine((value) => Math.abs(value) <= 10_000_000, "Too many coins."),
  type: z.enum(["ADJUSTMENT", "PROMO_BONUS", "REFUND"]),
  reason: z.string().trim().min(10).max(250),
});

/** Manual coins in or out (Web365 staff), recorded as its own ledger entry with the reason. */
export async function adjustWallet(actor: PlatformActor, input: unknown) {
  const data = adjustmentSchema.parse(input);
  if (data.type !== "ADJUSTMENT" && data.coins < 0) throw new DomainError("Bonuses and refunds add coins; use a manual adjustment to remove coins.");
  const result = await platformQuery(async (query) => {
    const [tenant] = await query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1`, [data.tenantId]);
    if (!tenant) throw new DomainError("Pharmacy not found.", 404);
    await ensureWallet(query, data.tenantId);
    return postEntry(query, { tenantId: data.tenantId, type: data.type, availableDelta: data.coins, idempotencyKey: `adjust:${randomUUID()}`, description: `${TRANSACTION_LABELS[data.type]} by Web365: ${data.reason}`, relatedType: "Adjustment", by: { id: actor.id, name: `${actor.name} (Web365)` } });
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.wallet-adjust", targetType: "AIWallet", targetId: data.tenantId, tenantId: data.tenantId, summary: `${TRANSACTION_LABELS[data.type]}: ${data.coins > 0 ? "+" : ""}${data.coins} coins (${data.reason}); balance ${result.wallet.available}`, severity: "warning" });
  await notifyPharmacy(data.tenantId, [{ title: data.coins > 0 ? `${data.coins.toLocaleString("en-NG")} AI coins added by Web365` : `${Math.abs(data.coins).toLocaleString("en-NG")} AI coins removed by Web365`, body: `${data.reason}. Balance: ${result.wallet.available.toLocaleString("en-NG")} coins.`, severity: data.coins > 0 ? "info" : "warning", audience: "ai.wallet.view" }]);
  return tenantDetail(data.tenantId);
}

export async function setWalletStatus(actor: PlatformActor, tenantId: string, status: "ACTIVE" | "SUSPENDED", reason: string) {
  if (reason.trim().length < 10) throw new DomainError("Give a reason (at least 10 characters).");
  await platformQuery(async (query) => {
    await ensureWallet(query, tenantId);
    await query(`UPDATE ai_wallets SET status = $1 WHERE tenant_id = $2`, [status, tenantId]);
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.wallet-status", targetType: "AIWallet", targetId: tenantId, tenantId, summary: `AI wallet ${status === "ACTIVE" ? "reactivated" : "suspended"}: ${reason.trim()}`, severity: "warning" });
  return tenantDetail(tenantId);
}

// ---------------------------------------------------------------- limits

const limitSchema = z.object({
  tenantId: z.string().min(1).nullable(),
  maxDailyCost: z.number().min(0).max(1_000_000).nullable(),
  maxMonthlyCost: z.number().min(0).max(10_000_000).nullable(),
  maxJobsPerDay: z.number().int().min(0).max(100_000).nullable(),
  maxPagesPerJob: z.number().int().min(1).max(1000).nullable(),
  maxConcurrentJobs: z.number().int().min(1).max(1000).nullable(),
  maxRequestsPerUserPerDay: z.number().int().min(0).max(100_000).nullable(),
  paused: z.boolean(),
});

export async function limitsView() {
  const rows = await platformQuery((query) => query<Record<string, unknown>>(`SELECT l.*, l.max_daily_cost::float8 AS daily, l.max_monthly_cost::float8 AS monthly, t.name AS tenant_name FROM ai_usage_limits l LEFT JOIN tenants t ON t.id = l.tenant_id ORDER BY l.tenant_id NULLS FIRST`));
  const [spend] = await platformQuery((query) => query<Record<string, number>>(`SELECT COALESCE(SUM(cost) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::float8 AS day, COALESCE(SUM(cost) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::float8 AS month FROM ai_usage WHERE created_at >= date_trunc('month', now())`));
  return {
    spend: { today: Number(spend.day), month: Number(spend.month), currency: "USD" },
    rows: rows.map((row) => ({ tenantId: (row.tenant_id as string | null) ?? null, tenantName: (row.tenant_name as string | null) ?? null, maxDailyCost: row.daily === null ? null : Number(row.daily), maxMonthlyCost: row.monthly === null ? null : Number(row.monthly), maxJobsPerDay: row.max_jobs_per_day === null ? null : Number(row.max_jobs_per_day), maxPagesPerJob: row.max_pages_per_job === null ? null : Number(row.max_pages_per_job), maxConcurrentJobs: row.max_concurrent_jobs === null ? null : Number(row.max_concurrent_jobs), maxRequestsPerUserPerDay: row.max_requests_per_user_per_day === null ? null : Number(row.max_requests_per_user_per_day), paused: Boolean(row.paused), updatedBy: (row.updated_by as string | null) ?? null, updatedAt: iso(row.updated_at) })),
  };
}

export async function setLimits(actor: PlatformActor, input: unknown) {
  const data = limitSchema.parse(input);
  await platformQuery(async (query) => {
    if (data.tenantId) {
      const [tenant] = await query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1`, [data.tenantId]);
      if (!tenant) throw new DomainError("Pharmacy not found.", 404);
    }
    await query(
      `INSERT INTO ai_usage_limits (id, tenant_id, max_daily_cost, max_monthly_cost, max_jobs_per_day, max_pages_per_job, max_concurrent_jobs, max_requests_per_user_per_day, paused, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT ((COALESCE(tenant_id, ''))) DO UPDATE SET max_daily_cost = EXCLUDED.max_daily_cost, max_monthly_cost = EXCLUDED.max_monthly_cost, max_jobs_per_day = EXCLUDED.max_jobs_per_day,
         max_pages_per_job = EXCLUDED.max_pages_per_job, max_concurrent_jobs = EXCLUDED.max_concurrent_jobs, max_requests_per_user_per_day = EXCLUDED.max_requests_per_user_per_day, paused = EXCLUDED.paused, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [`aul-${randomUUID()}`, data.tenantId, data.maxDailyCost, data.maxMonthlyCost, data.maxJobsPerDay, data.maxPagesPerJob, data.maxConcurrentJobs, data.maxRequestsPerUserPerDay, data.paused, actor.name],
    );
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.limits", targetType: "AIUsageLimit", targetId: data.tenantId ?? "global", tenantId: data.tenantId, summary: `${data.tenantId ? "Pharmacy" : "Platform-wide"} AI limits: ${JSON.stringify({ ...data, tenantId: undefined })}`, severity: "warning" });
  return limitsView();
}

export async function removeTenantLimits(actor: PlatformActor, tenantId: string) {
  await platformQuery((query) => query(`DELETE FROM ai_usage_limits WHERE tenant_id = $1`, [tenantId]));
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.limits", targetType: "AIUsageLimit", targetId: tenantId, tenantId, summary: "Pharmacy AI limits removed (platform limits apply)" });
  return limitsView();
}

// ---------------------------------------------------------------- purchases, reconciliation, settings

export async function purchasesView(input: { status?: string | null }) {
  const status = input.status && ["PENDING", "SUCCESS", "FAILED", "ABANDONED", "REFUNDED"].includes(input.status) ? input.status : null;
  const rows = await platformQuery((query) =>
    query<Record<string, unknown>>(
      `SELECT c.id, c.reference, c.tenant_id, t.name AS tenant, c.package_name, c.coins, c.bonus_coins, c.amount::float8 AS amount, c.fees::float8 AS fees, c.currency, c.status, c.failure_reason, c.settled_by, c.initiated_by_name, c.created_at, c.paid_at, c.credited_at, c.refunded_at
         FROM ai_coin_purchases c JOIN tenants t ON t.id = c.tenant_id WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.created_at DESC LIMIT 200`,
      [status],
    ),
  );
  return rows.map((row) => ({ id: String(row.id), reference: String(row.reference), tenantId: String(row.tenant_id), tenant: String(row.tenant), packageName: String(row.package_name), coins: Number(row.coins) + Number(row.bonus_coins), amount: Number(row.amount), fees: row.fees === null ? null : Number(row.fees), currency: String(row.currency), status: String(row.status), failureReason: (row.failure_reason as string | null) ?? null, settledBy: (row.settled_by as string | null) ?? null, by: String(row.initiated_by_name), createdAt: iso(row.created_at), paidAt: iso(row.paid_at), creditedAt: iso(row.credited_at), refundedAt: iso(row.refunded_at) }));
}

export async function recheckPurchase(actor: PlatformActor, reference: string) {
  const result = await settleCoinPurchase(reference, "manual");
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.purchase-recheck", targetType: "AICoinPurchase", targetId: reference, tenantId: result.tenantId, summary: `Re-checked AI coin purchase ${reference} with Paystack: ${result.outcome}` });
  return result;
}

export async function refundPurchase(actor: PlatformActor, purchaseId: string, reason: string) {
  return refundCoinPurchase(actor, purchaseId, reason);
}

export async function reconciliationView() {
  const rows = await platformQuery((query) => query<Record<string, unknown>>(`SELECT * FROM ai_reconciliation_runs ORDER BY started_at DESC LIMIT 30`));
  return rows.map((row) => ({ id: String(row.id), trigger: String(row.trigger), startedAt: iso(row.started_at), finishedAt: iso(row.finished_at), walletsChecked: Number(row.wallets_checked), mismatches: (typeof row.mismatches === "string" ? JSON.parse(row.mismatches) : row.mismatches) as unknown[], actions: (typeof row.actions === "string" ? JSON.parse(row.actions) : row.actions) as string[] }));
}

export async function runReconciliation(actor: PlatformActor) {
  const result = await reconcileAi(`manual:${actor.name}`, { purchaseAgeMinutes: 0 });
  await recordPlatformAudit(platformActorRef(actor), { action: "ai.reconcile", targetType: "AIWallet", targetId: "all", summary: `AI wallet reconciliation: ${result?.walletsChecked ?? 0} wallet(s), ${result?.mismatches.length ?? 0} difference(s), ${result?.actions.length ?? 0} action(s)` });
  return result;
}

export async function walletSettings() {
  return describePlatformSetting("ai.wallet");
}

export async function updateWalletSettings(actor: PlatformActor, value: unknown) {
  if (!value || typeof value !== "object") throw new DomainError("Nothing to save.");
  const input = { ...(value as Record<string, unknown>) };
  if (Array.isArray(input.lowBalanceThresholds)) input.lowBalanceThresholds = [...new Set((input.lowBalanceThresholds as number[]).map(Number))].sort((a, b) => b - a);
  return updatePlatformSetting(actor, "ai.wallet", { value: input });
}
