import { DashboardShell } from "@/components/dashboard-shell";
import { listDevices } from "@/lib/erp/offline-devices";
import { listOfflineOperations, unverifiedPayments } from "@/lib/erp/offline-reconcile";
import { outletName } from "@/lib/erp/services";
import { can, isOutletScoped } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { ReconcileWorkspace } from "./reconcile-workspace";

export const metadata = { title: "Offline Sync & Reconciliation" };

export default async function OfflineReconciliationPage() {
  return pageData(["stock.approve", "sales.supervise"], "/inventory/offline", async (actor) => {
    const devices = can(actor, "settings.manage") || !isOutletScoped(actor.role) ? await listDevices(actor) : [];
    return (
      <DashboardShell>
        <ReconcileWorkspace
          operations={await listOfflineOperations(actor)}
          payments={unverifiedPayments(actor)}
          devices={devices.filter((device) => device.status === "ACTIVE" && (device.pendingCount > 0 || device.failedCount > 0))}
          permissions={{ resolve: can(actor, "stock.approve"), verify: can(actor, "sales.supervise") || can(actor, "finance.approve") }}
          scope={actor.outletId ? outletName(actor.outletId) : undefined}
        />
      </DashboardShell>
    );
  });
}
