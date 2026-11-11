import { DashboardShell } from "@/components/dashboard-shell";
import { listImports } from "@/lib/erp/inventory-import";
import { outletName } from "@/lib/erp/services";
import { can } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { HistoryWorkspace } from "./history-workspace";

export default async function ImportHistoryPage() {
  return pageData("inventory.import", "/inventory/import/history", async (actor) => {
    const imports = await listImports(actor);
    return (
      <DashboardShell>
        <HistoryWorkspace imports={imports} canRollback={can(actor, "stock.approve")} scope={actor.outletId ? outletName(actor.outletId) : undefined} />
      </DashboardShell>
    );
  });
}
