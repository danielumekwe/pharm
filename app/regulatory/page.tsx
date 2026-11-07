import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { licenceRows, registrationRows, RENEWAL_WINDOW_DAYS } from "@/lib/erp/regulatory";
import { getCompliance } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { DOCUMENT_CATEGORIES } from "@/lib/erp/types";
import { can } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { RegulatoryWorkspace } from "./regulatory-workspace";

export default async function RegulatoryPage() {
  return pageData("regulatory.view", "/regulatory", async (actor) => {
    const compliance = getCompliance();
    const store = getStore();

    return (
      <DashboardShell>
        <RegulatoryWorkspace
          registrations={registrationRows()}
          licences={licenceRows()}
          documents={store.documents.map(({ storedName: _stored, ...document }) => {
            void _stored;
            return document;
          })}
          categories={[...DOCUMENT_CATEGORIES]}
          relatedOptions={[
            ...outlets.map((outlet) => ({ value: outlet.id, label: `Outlet: ${outlet.name}` })),
            ...store.registrations.map((registration) => ({ value: registration.productName, label: `Product: ${registration.productName}` })),
          ]}
          expiredBatches={compliance.expired.length}
          renewalWindow={RENEWAL_WINDOW_DAYS}
          canManage={can(actor, "regulatory.manage")}
        />
      </DashboardShell>
    );
  });
}
