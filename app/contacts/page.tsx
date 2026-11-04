import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { ContactsWorkspace } from "./contacts-workspace";

export default async function ContactsPage() {
  const actor = await requirePage("contacts.view", "/contacts");
  const store = getStore();

  return (
    <DashboardShell>
      <ContactsWorkspace
        customers={scopeByOutlet(actor, store.customers, (customer) => customer.outletId)}
        suppliers={store.suppliers}
        outlets={outlets.filter((outlet) => outlet.type !== "WAREHOUSE").map((outlet) => ({ id: outlet.id, name: outlet.name }))}
        scope={actor.outletId ? outletName(actor.outletId) : undefined}
        canManage={can(actor, "contacts.manage")}
        canVerify={can(actor, "purchase.approve") || can(actor, "audit.view")}
      />
    </DashboardShell>
  );
}
