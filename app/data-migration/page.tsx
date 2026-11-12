import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { listJobs, scannerSettings, STOCK_MODE_LABELS } from "@/lib/erp/document-scans";
import { outletName } from "@/lib/erp/services";
import { can, isOutletScoped } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { ImportCentre } from "./import-centre";

export default async function DataImportCentrePage() {
  return pageData(["documents.scan", "documents.approve", "inventory.import"], "/data-migration", async (actor) => {
    const scanner = can(actor, "documents.scan") || can(actor, "documents.approve");
    const jobs = scanner ? (await listJobs(actor)).slice(0, 5) : [];
    const choices = outlets
      .filter((outlet) => outlet.status !== "CLOSED")
      .filter((outlet) => !isOutletScoped(actor.role) || outlet.id === actor.outletId)
      .map((outlet) => ({ id: outlet.id, name: outlet.name, code: outlet.code, warehouse: outlet.type === "WAREHOUSE" }));
    return (
      <DashboardShell>
        <ImportCentre
          canScan={scanner}
          canApprove={can(actor, "documents.approve")}
          canSpreadsheet={can(actor, "inventory.import")}
          settings={scanner ? scannerSettings(actor) : null}
          recent={jobs}
          outlets={choices}
          defaultOutletId={actor.outletId ?? choices.find((outlet) => !outlet.warehouse)?.id ?? ""}
          stockModes={STOCK_MODE_LABELS}
          scope={actor.outletId && isOutletScoped(actor.role) ? outletName(actor.outletId) : undefined}
        />
      </DashboardShell>
    );
  });
}
