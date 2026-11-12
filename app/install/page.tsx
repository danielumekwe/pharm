import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { offlinePolicy } from "@/lib/erp/offline-devices";
import { getStore } from "@/lib/erp/store";
import { isOutletScoped } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { InstallWorkspace } from "./install-workspace";

export const metadata = { title: "Install PharmaERP" };

export default async function InstallPage() {
  return pageData("dashboard.view", "/install", (actor) => {
    const choices = outlets.filter((outlet) => outlet.status !== "CLOSED" && (!isOutletScoped(actor.role) || actor.outletIds.includes(outlet.id))).map((outlet) => ({ id: outlet.id, name: outlet.name }));
    const policy = offlinePolicy();
    return (
      <DashboardShell>
        <InstallWorkspace
          offline={
            actor.tenantId && !actor.support
              ? {
                  tenantId: actor.tenantId,
                  tenantName: getStore().settings.businessName,
                  user: { id: actor.id, name: actor.name, role: actor.role },
                  outlets: choices,
                  defaultOutletId: actor.outletId && choices.some((outlet) => outlet.id === actor.outletId) ? actor.outletId : choices[0]?.id ?? "",
                  policy: { enabled: policy.enabled, sessionHours: policy.sessionHours },
                }
              : null
          }
        />
      </DashboardShell>
    );
  });
}
