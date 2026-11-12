// AI Wallet ↔ AI Document Scanner. Coins are reserved when pages are sent for reading, then each page is
// charged when it has been read (or released when it could not be read). Prices are those in force when the
// coins were reserved; a later price change never alters them.
//
// Per page: the first page of a job is a "standard page", later pages are "additional pages", and a page the
// AI reports as mostly handwritten is a "complex handwritten page". Because handwriting is only known after
// reading, each page reserves the highest of these prices and the difference is released when it is charged.
// Failed pages and proofreading cost nothing (their configured price, 0 by default).

import { platformQuery } from "@/lib/db/database";

import { currentPrices, chargeUnit, releaseJob, releaseUnit, reserve, walletFor, assertWithinLimits, ensureWallet, type WalletEvent, type Who } from "./wallet";

export const SCAN_SERVICE = "document-scan";
export const PAGE_CODES = { standard: "document.page.standard", additional: "document.page.additional", handwritten: "document.page.handwritten", failed: "document.page.failed" } as const;

type Snapshot = Record<string, { coins: number; priceId: string }>;

async function snapshot(tenantId: string): Promise<Snapshot> {
  return platformQuery(async (query) => {
    const prices = await currentPrices(query, tenantId);
    const out: Snapshot = {};
    for (const code of Object.values(PAGE_CODES)) {
      const price = prices.get(code);
      out[code] = { coins: price && price.enabled ? price.coins : 0, priceId: price?.id ?? "none" };
    }
    // A disabled handwriting price means handwritten pages are charged like other pages.
    if (!prices.get(PAGE_CODES.handwritten)?.enabled) out[PAGE_CODES.handwritten] = { ...out[PAGE_CODES.additional], priceId: out[PAGE_CODES.additional].priceId };
    return out;
  });
}

const perPageHold = (prices: Snapshot) => Math.max(prices[PAGE_CODES.standard].coins, prices[PAGE_CODES.additional].coins, prices[PAGE_CODES.handwritten].coins);

/** What reading `pages` more pages of a job would cost, and whether the wallet covers it. */
export async function scanEstimate(tenantId: string, jobId: string, pages: number) {
  const prices = await snapshot(tenantId);
  return platformQuery(async (query) => {
    const { wallet, events } = await ensureWallet(query, tenantId);
    const [{ charged }] = await query<{ charged: number }>(
      `SELECT COUNT(*)::int AS charged FROM ai_reservation_items i JOIN ai_reservations r ON r.id = i.reservation_id WHERE r.job_id = $1 AND r.tenant_id = $2 AND i.status IN ('CHARGED', 'HELD')`,
      [jobId, tenantId],
    );
    const first = charged === 0 && pages > 0;
    const standard = prices[PAGE_CODES.standard].coins;
    const additional = prices[PAGE_CODES.additional].coins;
    const handwritten = prices[PAGE_CODES.handwritten].coins;
    const minimum = pages === 0 ? 0 : (first ? standard + (pages - 1) * additional : pages * additional);
    const reserve = pages * perPageHold(prices);
    return {
      pages,
      prices: { standard, additional, handwritten },
      minimum,
      maximum: reserve,
      reserve,
      available: wallet.available,
      reserved: wallet.reserved,
      sufficient: wallet.available >= reserve,
      events,
    };
  });
}

/** Reserves coins for pages about to be read. Runs in the scanner's request transaction. */
export async function reservePages(input: { tenantId: string; jobId: string; jobReference: string; pageIds: string[]; by: Who & { id: string }; key: string }) {
  const prices = await snapshot(input.tenantId);
  const hold = perPageHold(prices);
  return platformQuery(async (query) => {
    await assertWithinLimits(query, { tenantId: input.tenantId, userId: input.by.id, jobId: input.jobId, pages: input.pageIds.length });
    // A page never has two holds: anything still held for these pages (e.g. an earlier, interrupted run) is returned first.
    for (const pageId of input.pageIds) await releaseUnit(query, { tenantId: input.tenantId, unitId: pageId, reason: "Superseded by a new reading", by: input.by });
    return reserve(query, { tenantId: input.tenantId, jobId: input.jobId, jobReference: input.jobReference, service: SCAN_SERVICE, units: input.pageIds.map((unitId) => ({ unitId, coins: hold })), prices, key: input.key, by: input.by });
  });
}

/** Charges a page that was read: standard (first page), additional, or handwritten price. */
export async function chargePage(input: { tenantId: string; jobId: string; jobReference: string; pageId: string; pageNumber: number; handwritten: boolean; by: Who }): Promise<{ coins: number; operationCode: string; events: WalletEvent[] }> {
  return platformQuery(async (query) => {
    // Serialise charges of one job so exactly one page is billed as its first page.
    await query(`SELECT id FROM ai_reservations WHERE job_id = $1 AND tenant_id = $2 FOR UPDATE`, [input.jobId, input.tenantId]);
    const [item] = await query<{ prices: Snapshot | string }>(
      `SELECT r.prices FROM ai_reservation_items i JOIN ai_reservations r ON r.id = i.reservation_id WHERE i.tenant_id = $1 AND i.unit_id = $2 AND i.status = 'HELD' ORDER BY r.created_at DESC LIMIT 1`,
      [input.tenantId, input.pageId],
    );
    if (!item) return { coins: 0, operationCode: PAGE_CODES.standard, events: [] };
    const prices: Snapshot = typeof item.prices === "string" ? JSON.parse(item.prices) : item.prices;
    const [{ charged }] = await query<{ charged: number }>(
      `SELECT COUNT(*)::int AS charged FROM ai_reservation_items i JOIN ai_reservations r ON r.id = i.reservation_id WHERE r.job_id = $1 AND r.tenant_id = $2 AND i.status = 'CHARGED' AND i.coins_charged > 0`,
      [input.jobId, input.tenantId],
    );
    const code = input.handwritten ? PAGE_CODES.handwritten : charged === 0 ? PAGE_CODES.standard : PAGE_CODES.additional;
    const coins = prices[code]?.coins ?? 0;
    const label = code === PAGE_CODES.handwritten ? "handwritten page" : code === PAGE_CODES.standard ? "standard page" : "additional page";
    const result = await chargeUnit(query, { tenantId: input.tenantId, unitId: input.pageId, coins, operationCode: code, description: `AI reading of page ${input.pageNumber} of ${input.jobReference} (${label})`, by: input.by });
    return { coins: result.charged, operationCode: code, events: result.events };
  });
}

/** A page that could not be read is not charged: its coins go back. */
export async function releasePage(input: { tenantId: string; pageId: string; reason: string; by: Who }) {
  return platformQuery((query) => releaseUnit(query, { tenantId: input.tenantId, unitId: input.pageId, reason: input.reason, by: input.by }));
}

export async function releaseScanJob(input: { tenantId: string; jobId: string; reason: string; by: Who }) {
  return platformQuery((query) => releaseJob(query, input));
}

export async function walletBalance(tenantId: string) {
  return platformQuery((query) => walletFor(query, tenantId));
}
