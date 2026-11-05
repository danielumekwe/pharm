import { batches, products } from "@/lib/data";
import { ledgerFor, summarise, verifyLedger } from "@/lib/erp/ledger";
import { scopeByOutlet } from "@/lib/erp/services";
import { LEDGER_TYPES, type StockLedgerType } from "@/lib/erp/types";
import { guarded } from "@/lib/session";

/**
 * Stock ledger rows, newest first. Filters: productId, batchId, outletId (central roles), type, from, to (YYYY-MM-DD).
 * ?verify=1 checks every cached balance against the ledger instead.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return guarded("stock.view", (actor) => {
    const outletId = actor.outletId ?? url.searchParams.get("outletId") ?? null;
    if (url.searchParams.get("verify")) {
      const mismatches = verifyLedger(outletId);
      return { healthy: mismatches.length === 0, mismatches };
    }
    const type = url.searchParams.get("type");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const productId = url.searchParams.get("productId") ?? undefined;
    const rows = scopeByOutlet(actor, ledgerFor({ productId, outletId, batchId: url.searchParams.get("batchId") ?? undefined }), (entry) => entry.outletId).filter(
      (entry) =>
        (!type || (LEDGER_TYPES.includes(type as StockLedgerType) && entry.type === type)) &&
        (!from || entry.at.slice(0, 10) >= from) &&
        (!to || entry.at.slice(0, 10) <= to),
    );
    // The stock calculation always covers the item's full history, whatever rows are filtered for display.
    const summary = productId
      ? summarise(scopeByOutlet(actor, ledgerFor({ productId }), (entry) => entry.outletId), batches.filter((batch) => batch.productId === productId))
      : undefined;
    return { total: rows.length, rows: rows.slice(0, 1000), summary, product: productId ? products.find((row) => row.id === productId)?.name : undefined };
  });
}
