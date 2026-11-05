import { DashboardShell } from "@/components/dashboard-shell";
import { stockLevels } from "@/lib/erp/pos";
import { outletName } from "@/lib/erp/services";
import { requirePage } from "@/lib/session";

import { StockLevelsView } from "./stock-levels-view";

/** Read-only stock levels for sales staff: how much of each item is left to sell. */
export default async function StockLevelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePage(["stock.levels", "stock.view"], "/stock-levels");
  const { q } = await searchParams;
  return (
    <DashboardShell>
      <StockLevelsView rows={stockLevels(actor)} scope={actor.outletId ? outletName(actor.outletId) : undefined} initialQuery={typeof q === "string" ? q : ""} />
    </DashboardShell>
  );
}
