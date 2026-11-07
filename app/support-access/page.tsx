import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { grantsForPharmacy } from "@/lib/platform/support";
import { pageData } from "@/lib/session";

import { SupportGrants } from "./support-grants";

export const metadata = { title: "Web365 support access" };

export default async function SupportAccessPage() {
  return pageData("settings.manage", "/support-access", async (actor) => {
    const grants = await grantsForPharmacy();
    return (
      <DashboardShell>
        <div className="mx-auto max-w-4xl space-y-6">
          <PageHeader
            eyebrow="Administration"
            title="Web365 support access"
            description="Web365 staff cannot see your pharmacy's records. When they need to help you, they ask here; you decide. Approved access is read-only and ends automatically."
          />
          <SupportGrants grants={grants} canDecide={!actor.support} />
        </div>
      </DashboardShell>
    );
  });
}
