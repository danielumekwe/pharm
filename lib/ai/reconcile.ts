// AI Wallet reconciliation (background job and Control Centre button):
// 1. Every wallet's balances are rebuilt from its ledger and compared (and reserved coins with the open holds).
//    Differences are reported for a person to investigate; nothing is silently "fixed".
// 2. Holds left behind by interrupted work are settled: a page that was read is charged once, a page that
//    was not (failed, cancelled, removed) gets its coins back. Pages still waiting or being read are left alone.
// 3. Coin purchases still pending are checked with Paystack again (a verified payment is credited once).

import { randomUUID } from "node:crypto";

import { platformQuery } from "@/lib/db/database";

import { reconcilePendingPurchases } from "./purchases";
import { chargePage, releasePage } from "./scan-billing";
import { SYSTEM } from "./wallet";

export type Mismatch = { tenantId: string; walletId: string; problem: string };

export async function reconcileAi(trigger: string, options: { minIntervalMinutes?: number; purchaseAgeMinutes?: number } = {}) {
  if (options.minIntervalMinutes) {
    const [recent] = await platformQuery((query) => query<{ id: string }>(`SELECT id FROM ai_reconciliation_runs WHERE started_at > now() - ($1 || ' minutes')::interval LIMIT 1`, [String(options.minIntervalMinutes)]));
    if (recent) return null;
  }
  const runId = `arr-${randomUUID()}`;
  await platformQuery((query) => query(`INSERT INTO ai_reconciliation_runs (id, trigger) VALUES ($1, $2)`, [runId, trigger]));
  const actions: string[] = [];

  // 2. Interrupted holds (older than the page lease, so work in progress is never touched).
  const held = await platformQuery((query) =>
    query<{ tenant_id: string; unit_id: string; job_id: string; job_reference: string }>(
      `SELECT i.tenant_id, i.unit_id, r.job_id, r.job_reference FROM ai_reservation_items i JOIN ai_reservations r ON r.id = i.reservation_id
        WHERE i.status = 'HELD' AND r.service = 'document-scan' AND r.created_at < now() - interval '15 minutes' ORDER BY r.created_at LIMIT 500`,
    ),
  );
  for (const item of held) {
    const [page] = await platformQuery((query) =>
      query<{ status: string; extraction: { handwriting?: string } | string | null; job_status: string | null; position: number }>(
        `SELECT p.status, p.extraction, j.status AS job_status, p.position FROM document_scan_pages p JOIN document_scan_jobs j ON j.id = p.job_id AND j.tenant_id = p.tenant_id WHERE p.id = $1 AND p.tenant_id = $2`,
        [item.unit_id, item.tenant_id],
        item.tenant_id,
      ),
    );
    if (page && (page.status === "QUEUED" || page.status === "PROCESSING") && page.job_status !== "CANCELLED") continue;
    if (page?.status === "DONE") {
      const extraction = typeof page.extraction === "string" ? JSON.parse(page.extraction) : page.extraction;
      const charge = await chargePage({ tenantId: item.tenant_id, jobId: item.job_id, jobReference: item.job_reference, pageId: item.unit_id, pageNumber: page.position, handwritten: extraction?.handwriting === "mostly", by: SYSTEM });
      actions.push(`${item.job_reference}: charged ${charge.coins} coins for a page read before an interruption`);
    } else {
      const released = await releasePage({ tenantId: item.tenant_id, pageId: item.unit_id, reason: page ? "Page was not read" : "Page was removed", by: SYSTEM });
      actions.push(`${item.job_reference}: returned ${released.released} held coins (${page ? `page ${page.status.toLowerCase()}` : "page removed"})`);
    }
  }

  // 3. Pending purchases.
  for (const result of await reconcilePendingPurchases(options.purchaseAgeMinutes ?? 5).catch((error) => {
    actions.push(`Purchase check failed: ${error instanceof Error ? error.message : "error"}`);
    return [];
  })) {
    if (result.outcome !== "pending") actions.push(`Purchase ${result.reference}: ${result.outcome}`);
  }

  // 1. Ledger vs balances (after the settlements above).
  const mismatches: Mismatch[] = [];
  const wallets = await platformQuery((query) =>
    query<{ id: string; tenant_id: string; available: number; reserved: number; ledger_available: number; ledger_reserved: number; last_available: number | null; last_reserved: number | null; held: number }>(
      `SELECT w.id, w.tenant_id, w.available, w.reserved,
              COALESCE((SELECT SUM(available_delta) FROM ai_wallet_transactions t WHERE t.wallet_id = w.id), 0)::int AS ledger_available,
              COALESCE((SELECT SUM(reserved_delta) FROM ai_wallet_transactions t WHERE t.wallet_id = w.id), 0)::int AS ledger_reserved,
              (SELECT available_after FROM ai_wallet_transactions t WHERE t.wallet_id = w.id ORDER BY seq DESC LIMIT 1) AS last_available,
              (SELECT reserved_after FROM ai_wallet_transactions t WHERE t.wallet_id = w.id ORDER BY seq DESC LIMIT 1) AS last_reserved,
              COALESCE((SELECT SUM(i.coins_reserved) FROM ai_reservation_items i WHERE i.tenant_id = w.tenant_id AND i.status = 'HELD'), 0)::int AS held
         FROM ai_wallets w`,
    ),
  );
  for (const wallet of wallets) {
    const problems: string[] = [];
    if (Number(wallet.available) !== Number(wallet.ledger_available)) problems.push(`available ${wallet.available} ≠ ledger ${wallet.ledger_available}`);
    if (Number(wallet.reserved) !== Number(wallet.ledger_reserved)) problems.push(`reserved ${wallet.reserved} ≠ ledger ${wallet.ledger_reserved}`);
    if (Number(wallet.reserved) !== Number(wallet.held)) problems.push(`reserved ${wallet.reserved} ≠ open holds ${wallet.held}`);
    if (wallet.last_available !== null && Number(wallet.last_available) !== Number(wallet.available)) problems.push(`last entry balance ${wallet.last_available} ≠ wallet ${wallet.available}`);
    for (const problem of problems) mismatches.push({ tenantId: wallet.tenant_id, walletId: wallet.id, problem });
  }

  await platformQuery((query) => query(`UPDATE ai_reconciliation_runs SET finished_at = now(), wallets_checked = $1, mismatches = $2::jsonb, actions = $3::jsonb WHERE id = $4`, [wallets.length, JSON.stringify(mismatches), JSON.stringify(actions), runId]));
  if (mismatches.length) console.error(`[ai-wallet] reconciliation found ${mismatches.length} difference(s)`);
  return { id: runId, walletsChecked: wallets.length, mismatches, actions };
}
