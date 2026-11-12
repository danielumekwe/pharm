// AI Wallet: one coin wallet per pharmacy, kept by an append-only ledger (ai_wallet_transactions).
//
// Rules:
// - Every balance change is one ledger entry written in the same database transaction as the wallet row,
//   with the wallet row locked (FOR UPDATE), so concurrent requests cannot spend the same coins.
// - Every entry has an idempotency key: repeating an operation (double click, retry, duplicate webhook,
//   restarted worker) finds the earlier entry and changes nothing.
// - Balances never go below zero (checked here and by database constraints). Reserved coins cannot be spent.
// - Entries are never edited or deleted (database trigger); corrections are new entries.
// - AI work reserves coins first; each unit (page) is then charged or released exactly once.
//
// All functions take a PlatformQuery: inside a pharmacy request it runs in that request's transaction, so the
// wallet change commits or rolls back together with the work it pays for.

import { randomBytes, randomUUID } from "node:crypto";

import type { PlatformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { SETTINGS, type SettingValue } from "@/lib/platform/settings";

/**
 * The AI Wallet settings read through the caller's own connection: a second connection opened while a
 * wallet transaction holds one could wait for ever on a small pool.
 */
export async function walletConfig(query: PlatformQuery): Promise<SettingValue<"ai.wallet">> {
  const definition = SETTINGS["ai.wallet"];
  const [row] = await query<{ value: unknown }>(`SELECT value FROM platform_settings WHERE key = 'ai.wallet'`);
  const stored = typeof row?.value === "string" ? JSON.parse(row.value) : row?.value && typeof row.value === "object" ? row.value : {};
  const parsed = definition.value.safeParse({ ...definition.defaults, ...stored });
  return parsed.success ? parsed.data : definition.defaults;
}

export type TransactionType = "WELCOME_BONUS" | "PURCHASE" | "PROMO_BONUS" | "AI_USAGE" | "REFUND" | "RESERVATION" | "RESERVATION_RELEASE" | "ADJUSTMENT" | "PURCHASE_REVERSAL" | "EXPIRY";

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  WELCOME_BONUS: "Welcome Bonus",
  PURCHASE: "Coin Purchase",
  PROMO_BONUS: "Promotional Bonus",
  AI_USAGE: "AI Usage",
  REFUND: "Refund",
  RESERVATION: "Reservation",
  RESERVATION_RELEASE: "Reservation Release",
  ADJUSTMENT: "Manual Adjustment",
  PURCHASE_REVERSAL: "Purchase Refunded",
  EXPIRY: "Expiry",
};

export const INSUFFICIENT_COINS = "You do not have enough AI coins to process these documents. Please purchase additional coins.";

export type Wallet = {
  id: string;
  tenantId: string;
  available: number;
  reserved: number;
  purchasedTotal: number;
  freeTotal: number;
  consumedTotal: number;
  refundedTotal: number;
  status: "ACTIVE" | "SUSPENDED";
  lowBalanceNotified: number | null;
  createdAt: string;
  lastTransactionAt: string | null;
};

export type Who = { id: string | null; name: string };
export const SYSTEM: Who = { id: null, name: "System" };

type WalletRow = Record<string, unknown>;
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);

function walletFrom(row: WalletRow): Wallet {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    available: Number(row.available),
    reserved: Number(row.reserved),
    purchasedTotal: Number(row.purchased_total),
    freeTotal: Number(row.free_total),
    consumedTotal: Number(row.consumed_total),
    refundedTotal: Number(row.refunded_total),
    status: row.status as Wallet["status"],
    lowBalanceNotified: row.low_balance_notified === null || row.low_balance_notified === undefined ? null : Number(row.low_balance_notified),
    createdAt: iso(row.created_at) ?? "",
    lastTransactionAt: iso(row.last_transaction_at),
  };
}

export async function walletFor(query: PlatformQuery, tenantId: string, lock = false) {
  const [row] = await query<WalletRow>(`SELECT * FROM ai_wallets WHERE tenant_id = $1${lock ? " FOR UPDATE" : ""}`, [tenantId]);
  return row ? walletFrom(row) : null;
}

export type WalletEvent = { kind: "credited" | "low-balance"; coins?: number; reason?: string; balance: number; threshold?: number };

/**
 * The pharmacy's wallet, opened on first use. Opening it gives the welcome bonus once per pharmacy (when the
 * promotion is on): the bonus is tied to the pharmacy, so new staff accounts or outlets never add another.
 */
export async function ensureWallet(query: PlatformQuery, tenantId: string): Promise<{ wallet: Wallet; events: WalletEvent[] }> {
  const existing = await walletFor(query, tenantId);
  if (existing) return { wallet: existing, events: [] };
  await query(`INSERT INTO ai_wallets (id, tenant_id) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`, [`aiw-${randomUUID()}`, tenantId]);
  const events: WalletEvent[] = [];
  const config = await walletConfig(query);
  if (config.welcomeBonusEnabled && config.welcomeBonusCoins > 0) {
    const result = await postEntry(query, {
      tenantId,
      type: "WELCOME_BONUS",
      availableDelta: config.welcomeBonusCoins,
      idempotencyKey: `welcome:${tenantId}`,
      description: config.welcomeBonusReason,
      relatedType: "Promotion",
      relatedId: "welcome-bonus",
      by: SYSTEM,
    });
    if (!result.duplicate) events.push({ kind: "credited", coins: config.welcomeBonusCoins, reason: config.welcomeBonusReason, balance: result.wallet.available });
  }
  return { wallet: (await walletFor(query, tenantId))!, events };
}

type Entry = {
  tenantId: string;
  type: TransactionType;
  /** Change to the spendable balance (negative spends). */
  availableDelta?: number;
  /** Change to the reserved balance. */
  reservedDelta?: number;
  idempotencyKey: string;
  description: string;
  relatedType?: string;
  relatedId?: string;
  operationCode?: string;
  by: Who;
  /** Allow a debit to take the balance below zero? Never. (Kept explicit for readers.) */
};

export type LedgerEntry = {
  id: string;
  reference: string;
  type: TransactionType;
  direction: "CREDIT" | "DEBIT" | "HOLD" | "RELEASE";
  amount: number;
  availableAfter: number;
  reservedAfter: number;
};

function directionOf(type: TransactionType, available: number, reserved: number): LedgerEntry["direction"] {
  if (type === "RESERVATION") return "HOLD";
  if (type === "RESERVATION_RELEASE") return "RELEASE";
  if (type === "AI_USAGE") return "DEBIT";
  return available + reserved >= 0 ? "CREDIT" : "DEBIT";
}

const reference = () => `AIW-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

/**
 * Writes one ledger entry and updates the wallet, exactly once per idempotency key. Throws (and changes
 * nothing) if the entry would make a balance negative.
 */
export async function postEntry(query: PlatformQuery, entry: Entry): Promise<{ wallet: Wallet; entry: LedgerEntry; duplicate: boolean; events: WalletEvent[] }> {
  const available = Math.trunc(entry.availableDelta ?? 0);
  const reserved = Math.trunc(entry.reservedDelta ?? 0);
  const amount = entry.type === "RESERVATION" || entry.type === "RESERVATION_RELEASE" ? Math.abs(reserved) : entry.type === "AI_USAGE" ? Math.abs(reserved || available) : Math.abs(available + reserved);
  if (amount <= 0) throw new Error(`Wallet entry ${entry.type} has no amount.`);

  // The wallet lock serialises every change to this pharmacy's coins (and repeated keys behind it).
  const wallet = await walletFor(query, entry.tenantId, true);
  if (!wallet) throw new DomainError("This pharmacy has no AI wallet yet.", 409);
  const [previous] = await query<Record<string, unknown>>(`SELECT id, reference, type, direction, amount, available_after, reserved_after FROM ai_wallet_transactions WHERE idempotency_key = $1`, [entry.idempotencyKey]);
  if (previous) {
    return {
      wallet,
      duplicate: true,
      events: [],
      entry: { id: String(previous.id), reference: String(previous.reference), type: previous.type as TransactionType, direction: previous.direction as LedgerEntry["direction"], amount: Number(previous.amount), availableAfter: Number(previous.available_after), reservedAfter: Number(previous.reserved_after) },
    };
  }
  if (wallet.status !== "ACTIVE" && available < 0 && entry.type !== "ADJUSTMENT" && entry.type !== "PURCHASE_REVERSAL") throw new DomainError("This pharmacy's AI wallet is suspended. Contact Web365.", 403);
  const nextAvailable = wallet.available + available;
  const nextReserved = wallet.reserved + reserved;
  if (nextAvailable < 0) throw new DomainError(entry.type === "RESERVATION" ? INSUFFICIENT_COINS : `Not enough AI coins: ${wallet.available} available.`, 402);
  if (nextReserved < 0) throw new Error("Reserved coins would go below zero.");

  const totals = {
    purchased: entry.type === "PURCHASE" ? available : 0,
    free: entry.type === "WELCOME_BONUS" || entry.type === "PROMO_BONUS" ? available : 0,
    consumed: entry.type === "AI_USAGE" ? -(reserved + available) : 0,
    refunded: entry.type === "REFUND" ? available : 0,
  };
  const row: LedgerEntry = { id: `awt-${randomUUID()}`, reference: reference(), type: entry.type, direction: directionOf(entry.type, available, reserved), amount, availableAfter: nextAvailable, reservedAfter: nextReserved };
  await query(
    `INSERT INTO ai_wallet_transactions (id, tenant_id, wallet_id, reference, type, direction, amount, available_delta, reserved_delta, available_after, reserved_after,
                                         related_type, related_id, operation_code, description, idempotency_key, created_by_id, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [row.id, entry.tenantId, wallet.id, row.reference, entry.type, row.direction, amount, available, reserved, nextAvailable, nextReserved, entry.relatedType ?? null, entry.relatedId ?? null, entry.operationCode ?? null, entry.description.slice(0, 300), entry.idempotencyKey, entry.by.id, entry.by.name],
  );

  // Low-balance alerts: announce each threshold once as the balance falls; forget them when it rises above.
  const events: WalletEvent[] = [];
  let notified = wallet.lowBalanceNotified;
  if (available !== 0) {
    const thresholds = [...(await walletConfig(query)).lowBalanceThresholds].sort((a, b) => b - a);
    if (thresholds.length) {
      if (nextAvailable > thresholds[0]) notified = null;
      else if (available < 0) {
        const reached = thresholds.filter((threshold) => nextAvailable <= threshold).at(-1)!;
        if (notified === null || reached < notified) {
          notified = reached;
          events.push({ kind: "low-balance", balance: nextAvailable, threshold: reached });
        }
      }
    }
  }
  await query(
    `UPDATE ai_wallets SET available = $1, reserved = $2, purchased_total = purchased_total + $3, free_total = free_total + $4, consumed_total = consumed_total + $5,
            refunded_total = refunded_total + $6, low_balance_notified = $7, last_transaction_at = now() WHERE id = $8`,
    [nextAvailable, nextReserved, totals.purchased, totals.free, totals.consumed, totals.refunded, notified, wallet.id],
  );
  return { wallet: { ...wallet, available: nextAvailable, reserved: nextReserved, lowBalanceNotified: notified }, entry: row, duplicate: false, events };
}

// ---------------------------------------------------------------- prices

export type Price = { id: string; code: string; name: string; description: string; method: string; coins: number; enabled: boolean; tenantId: string | null; effectiveFrom: string };

/** Current prices (a pharmacy's own override wins over the standard price). The browser never supplies a price. */
export async function currentPrices(query: PlatformQuery, tenantId: string | null): Promise<Map<string, Price>> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, code, name, description, method, coins, enabled, tenant_id, effective_from FROM ai_operation_prices
      WHERE effective_to IS NULL AND (tenant_id IS NULL OR tenant_id = $1) ORDER BY (tenant_id IS NULL) DESC`,
    [tenantId],
  );
  const prices = new Map<string, Price>();
  for (const row of rows) {
    prices.set(String(row.code), { id: String(row.id), code: String(row.code), name: String(row.name), description: String(row.description), method: String(row.method), coins: Number(row.coins), enabled: Boolean(row.enabled), tenantId: (row.tenant_id as string | null) ?? null, effectiveFrom: iso(row.effective_from) ?? "" });
  }
  return prices;
}

// ---------------------------------------------------------------- reservations

export type ReservationUnit = { unitId: string; coins: number };

/**
 * Holds coins for a piece of AI work (one unit per page). The whole amount must be available; nothing is
 * spent yet. `key` makes a repeated request return the first reservation.
 */
export async function reserve(
  query: PlatformQuery,
  input: { tenantId: string; jobId: string; jobReference: string; service: string; units: ReservationUnit[]; prices: Record<string, { coins: number; priceId: string }>; key: string; by: Who & { id: string } },
) {
  const [existing] = await query<{ id: string }>(`SELECT id FROM ai_reservations WHERE idempotency_key = $1`, [input.key]);
  if (existing) return { id: existing.id, duplicate: true, coins: 0, events: [] as WalletEvent[] };
  const coins = input.units.reduce((sum, unit) => sum + unit.coins, 0);
  const id = `air-${randomUUID()}`;
  const { wallet } = await ensureWallet(query, input.tenantId);
  let events: WalletEvent[] = [];
  if (coins > 0) {
    events = (
      await postEntry(query, {
        tenantId: input.tenantId,
        type: "RESERVATION",
        availableDelta: -coins,
        reservedDelta: coins,
        idempotencyKey: `reserve:${input.key}`,
        description: `Reserved for ${input.units.length} page(s) of ${input.jobReference}`,
        relatedType: "ScanJob",
        relatedId: input.jobId,
        by: input.by,
      })
    ).events;
  }
  await query(
    `INSERT INTO ai_reservations (id, tenant_id, wallet_id, job_id, job_reference, service, prices, coins_reserved, idempotency_key, created_by_id, created_by_name, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, input.tenantId, wallet.id, input.jobId, input.jobReference, input.service, JSON.stringify(input.prices), coins, input.key, input.by.id, input.by.name, coins > 0 ? "OPEN" : "CLOSED"],
  );
  for (const unit of input.units) {
    await query(`INSERT INTO ai_reservation_items (id, reservation_id, tenant_id, unit_id, coins_reserved, status) VALUES ($1, $2, $3, $4, $5, $6)`, [`ari-${randomUUID()}`, id, input.tenantId, unit.unitId, unit.coins, unit.coins > 0 ? "HELD" : "RELEASED"]);
  }
  return { id, duplicate: false, coins, events };
}

type Item = { id: string; reservation_id: string; coins_reserved: number; status: string; job_id: string; job_reference: string; prices: Record<string, { coins: number; priceId: string }> };

async function heldItem(query: PlatformQuery, tenantId: string, unitId: string) {
  const [item] = await query<Item>(
    `SELECT i.id, i.reservation_id, i.coins_reserved, i.status, r.job_id, r.job_reference, r.prices
       FROM ai_reservation_items i JOIN ai_reservations r ON r.id = i.reservation_id
      WHERE i.tenant_id = $1 AND i.unit_id = $2 AND i.status = 'HELD' ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE OF i`,
    [tenantId, unitId],
  );
  return item ? { ...item, coins_reserved: Number(item.coins_reserved), prices: typeof item.prices === "string" ? JSON.parse(item.prices) : item.prices } : null;
}

async function closeIfDone(query: PlatformQuery, reservationId: string) {
  await query(
    `UPDATE ai_reservations r SET status = 'CLOSED', closed_at = now(),
            coins_charged = (SELECT COALESCE(SUM(coins_charged), 0)::int FROM ai_reservation_items WHERE reservation_id = r.id),
            coins_released = r.coins_reserved - (SELECT COALESCE(SUM(coins_charged), 0)::int FROM ai_reservation_items WHERE reservation_id = r.id)
      WHERE r.id = $1 AND r.status = 'OPEN' AND NOT EXISTS (SELECT 1 FROM ai_reservation_items WHERE reservation_id = r.id AND status = 'HELD')`,
    [reservationId],
  );
}

/** The price snapshot of the unit's open reservation (prices in force when the coins were reserved). */
export async function reservedPrices(query: PlatformQuery, tenantId: string, unitId: string) {
  const item = await heldItem(query, tenantId, unitId);
  return item ? { prices: item.prices, reserved: item.coins_reserved, jobId: item.job_id } : null;
}

/**
 * Charges a finished unit at `coins` (never more than was reserved for it) and releases the rest. Repeated
 * calls for the same unit do nothing: the item is no longer HELD and the ledger keys are taken.
 */
export async function chargeUnit(query: PlatformQuery, input: { tenantId: string; unitId: string; coins: number; operationCode: string; description: string; by: Who }) {
  const item = await heldItem(query, input.tenantId, input.unitId);
  if (!item) return { charged: 0, released: 0, events: [] as WalletEvent[], duplicate: true };
  const charged = Math.max(0, Math.min(item.coins_reserved, Math.trunc(input.coins)));
  const released = item.coins_reserved - charged;
  const events: WalletEvent[] = [];
  if (charged > 0) {
    events.push(...(await postEntry(query, { tenantId: input.tenantId, type: "AI_USAGE", reservedDelta: -charged, idempotencyKey: `charge:${item.id}`, description: input.description, relatedType: "ScanJob", relatedId: item.job_id, operationCode: input.operationCode, by: input.by })).events);
  }
  if (released > 0) {
    events.push(...(await postEntry(query, { tenantId: input.tenantId, type: "RESERVATION_RELEASE", availableDelta: released, reservedDelta: -released, idempotencyKey: `release:${item.id}`, description: `Unused reservation returned (${item.job_reference})`, relatedType: "ScanJob", relatedId: item.job_id, operationCode: input.operationCode, by: input.by })).events);
  }
  await query(`UPDATE ai_reservation_items SET status = 'CHARGED', coins_charged = $1, operation_code = $2, settled_at = now() WHERE id = $3`, [charged, input.operationCode, item.id]);
  await closeIfDone(query, item.reservation_id);
  return { charged, released, events, duplicate: false };
}

/** Returns a unit's reserved coins unspent (failed or cancelled work). Repeated calls do nothing. */
export async function releaseUnit(query: PlatformQuery, input: { tenantId: string; unitId: string; reason: string; by: Who }) {
  const item = await heldItem(query, input.tenantId, input.unitId);
  if (!item) return { released: 0 };
  if (item.coins_reserved > 0) {
    await postEntry(query, { tenantId: input.tenantId, type: "RESERVATION_RELEASE", availableDelta: item.coins_reserved, reservedDelta: -item.coins_reserved, idempotencyKey: `release:${item.id}`, description: `${input.reason.slice(0, 200)} (${item.job_reference}): coins returned`, relatedType: "ScanJob", relatedId: item.job_id, by: input.by });
  }
  await query(`UPDATE ai_reservation_items SET status = 'RELEASED', reason = $1, settled_at = now() WHERE id = $2`, [input.reason.slice(0, 300), item.id]);
  await closeIfDone(query, item.reservation_id);
  return { released: item.coins_reserved };
}

/** Releases every held unit of a job (job cancelled). */
export async function releaseJob(query: PlatformQuery, input: { tenantId: string; jobId: string; reason: string; by: Who }) {
  const units = await query<{ unit_id: string }>(`SELECT i.unit_id FROM ai_reservation_items i JOIN ai_reservations r ON r.id = i.reservation_id WHERE i.tenant_id = $1 AND r.job_id = $2 AND i.status = 'HELD'`, [input.tenantId, input.jobId]);
  let released = 0;
  for (const { unit_id } of units) released += (await releaseUnit(query, { tenantId: input.tenantId, unitId: unit_id, reason: input.reason, by: input.by })).released;
  return { released };
}

// ---------------------------------------------------------------- limits

export type Limits = { maxDailyCost: number | null; maxMonthlyCost: number | null; maxJobsPerDay: number | null; maxPagesPerJob: number | null; maxConcurrentJobs: number | null; maxRequestsPerUserPerDay: number | null; paused: boolean };

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
function limitsFrom(row: Record<string, unknown> | undefined): Limits {
  return { maxDailyCost: num(row?.max_daily_cost), maxMonthlyCost: num(row?.max_monthly_cost), maxJobsPerDay: num(row?.max_jobs_per_day), maxPagesPerJob: num(row?.max_pages_per_job), maxConcurrentJobs: num(row?.max_concurrent_jobs), maxRequestsPerUserPerDay: num(row?.max_requests_per_user_per_day), paused: Boolean(row?.paused) };
}

export async function limitsFor(query: PlatformQuery, tenantId: string | null) {
  const rows = await query<Record<string, unknown>>(`SELECT * FROM ai_usage_limits WHERE tenant_id IS NULL OR tenant_id = $1`, [tenantId]);
  return { global: limitsFrom(rows.find((row) => row.tenant_id === null)), tenant: tenantId ? limitsFrom(rows.find((row) => row.tenant_id === tenantId)) : null };
}

/**
 * Refuses new paid AI work when a platform or pharmacy limit is reached. Work already queued is not affected.
 * Pharmacy staff cannot change these limits (they are set in the Control Centre).
 */
export async function assertWithinLimits(query: PlatformQuery, input: { tenantId: string; userId: string; jobId: string; pages: number }) {
  const { global, tenant } = await limitsFor(query, input.tenantId);
  const pick = <K extends keyof Limits>(key: K) => (tenant && tenant[key] !== null && tenant[key] !== false ? tenant[key] : global[key]);
  const stop = (message: string) => {
    throw new DomainError(`${message} Queued pages and finished records are not affected. Contact Web365 if you need this limit changed.`, 429);
  };
  if (global.paused || tenant?.paused) stop("AI processing is paused by Web365 for now.");
  const maxPages = pick("maxPagesPerJob") as number | null;
  if (maxPages !== null && input.pages > maxPages) stop(`At most ${maxPages} pages can be read in one job.`);
  const [costs] = await query<{ day: number; month: number; tenant_day: number; tenant_month: number }>(
    `SELECT COALESCE(SUM(cost) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::float8 AS day,
            COALESCE(SUM(cost) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::float8 AS month,
            COALESCE(SUM(cost) FILTER (WHERE created_at >= date_trunc('day', now()) AND tenant_id = $1), 0)::float8 AS tenant_day,
            COALESCE(SUM(cost) FILTER (WHERE created_at >= date_trunc('month', now()) AND tenant_id = $1), 0)::float8 AS tenant_month
       FROM ai_usage WHERE created_at >= date_trunc('month', now())`,
    [input.tenantId],
  );
  if (global.maxDailyCost !== null && costs.day >= global.maxDailyCost) stop("Today's platform-wide AI spending limit has been reached. New AI jobs can start again tomorrow.");
  if (global.maxMonthlyCost !== null && costs.month >= global.maxMonthlyCost) stop("This month's platform-wide AI spending limit has been reached.");
  if (tenant?.maxDailyCost !== null && tenant?.maxDailyCost !== undefined && costs.tenant_day >= tenant.maxDailyCost) stop("Your pharmacy's daily AI spending limit has been reached.");
  if (tenant?.maxMonthlyCost !== null && tenant?.maxMonthlyCost !== undefined && costs.tenant_month >= tenant.maxMonthlyCost) stop("Your pharmacy's monthly AI spending limit has been reached.");
  const [counts] = await query<{ jobs_today: number; user_today: number; concurrent: number }>(
    `SELECT COUNT(DISTINCT job_id) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS jobs_today,
            COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND created_by_id = $2)::int AS user_today,
            COUNT(DISTINCT job_id) FILTER (WHERE status = 'OPEN' AND job_id <> $3)::int AS concurrent
       FROM ai_reservations WHERE tenant_id = $1`,
    [input.tenantId, input.userId, input.jobId],
  );
  const maxJobs = pick("maxJobsPerDay") as number | null;
  if (maxJobs !== null && counts.jobs_today >= maxJobs) stop(`Your pharmacy has reached its limit of ${maxJobs} AI jobs per day.`);
  const maxConcurrent = pick("maxConcurrentJobs") as number | null;
  if (maxConcurrent !== null && counts.concurrent >= maxConcurrent) stop(`At most ${maxConcurrent} AI job(s) can be read at the same time. Wait for the current job(s) to finish.`);
  const maxRequests = pick("maxRequestsPerUserPerDay") as number | null;
  if (maxRequests !== null && counts.user_today >= maxRequests) stop(`You have reached your limit of ${maxRequests} AI requests per day.`);
}

// ---------------------------------------------------------------- provider cost

export type ModelPrice = { id: string; provider: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; currency: string };

export async function modelPrice(query: PlatformQuery, provider: string, model: string): Promise<ModelPrice | null> {
  const [row] = await query<Record<string, unknown>>(
    `SELECT id, provider, model, input_per_mtok::float8 AS input, output_per_mtok::float8 AS output, cache_read_per_mtok::float8 AS cache_read, cache_write_per_mtok::float8 AS cache_write, currency
       FROM ai_model_prices WHERE provider = $1 AND model = $2 AND effective_to IS NULL`,
    [provider, model],
  );
  return row ? { id: String(row.id), provider: String(row.provider), model: String(row.model), input: Number(row.input), output: Number(row.output), cacheRead: Number(row.cache_read), cacheWrite: Number(row.cache_write), currency: String(row.currency) } : null;
}

export type Usage = { inputTokens?: number | null; outputTokens?: number | null; cacheReadTokens?: number | null; cacheCreationTokens?: number | null };

/** Estimated provider cost from the tokens the provider reported and the configured model price. */
export function estimateCost(price: ModelPrice | null, usage: Usage | null) {
  if (!price || !usage || usage.inputTokens === null || usage.inputTokens === undefined || usage.outputTokens === null || usage.outputTokens === undefined) return null;
  const cost = ((usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output + (usage.cacheReadTokens ?? 0) * price.cacheRead + (usage.cacheCreationTokens ?? 0) * price.cacheWrite) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export async function recordUsage(
  query: PlatformQuery,
  input: {
    tenantId: string;
    user: Who | null;
    service: string;
    operationCode: string | null;
    jobId: string | null;
    jobReference: string | null;
    unitId: string | null;
    provider: string;
    model: string;
    requestId: string | null;
    usage: Usage | null;
    durationMs: number | null;
    status: "SUCCESS" | "FAILED";
    attempt: number;
    error?: string | null;
    coinsCharged: number;
  },
) {
  const price = await modelPrice(query, input.provider, input.model);
  const cost = estimateCost(price, input.usage);
  await query(
    `INSERT INTO ai_usage (id, tenant_id, user_id, user_name, service, operation_code, job_id, job_reference, unit_id, provider, model, request_id, input_tokens, output_tokens,
                           cache_read_tokens, cache_creation_tokens, model_price_id, cost, cost_currency, cost_basis, duration_ms, status, attempt, error, coins_charged)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
    [
      `aiu-${randomUUID()}`, input.tenantId, input.user?.id ?? null, input.user?.name ?? null, input.service, input.operationCode, input.jobId, input.jobReference, input.unitId, input.provider, input.model, input.requestId,
      input.usage?.inputTokens ?? null, input.usage?.outputTokens ?? null, input.usage?.cacheReadTokens ?? null, input.usage?.cacheCreationTokens ?? null,
      cost === null ? null : price?.id ?? null, cost, price?.currency ?? "USD", cost === null ? "unavailable" : "estimated", input.durationMs, input.status, input.attempt, input.error?.slice(0, 300) ?? null, input.coinsCharged,
    ],
  );
  return cost;
}
