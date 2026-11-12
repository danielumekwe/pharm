import { DashboardShell } from "@/components/dashboard-shell";
import { listJobs } from "@/lib/erp/document-scans";
import { outletName } from "@/lib/erp/services";
import { isOutletScoped } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { ScanHistory } from "./scan-history";

export default async function ScanHistoryPage() {
  return pageData(["documents.scan", "documents.approve"], "/data-migration/scanner/history", async (actor) => {
    const jobs = await listJobs(actor);
    return (
      <DashboardShell>
        <ScanHistory jobs={jobs} scope={actor.outletId && isOutletScoped(actor.role) ? outletName(actor.outletId) : undefined} />
      </DashboardShell>
    );
  });
}
