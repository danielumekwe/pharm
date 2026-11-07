import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can, canAny } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { ContactsWorkspace } from "./contacts-workspace";

export default async function ContactsPage() {
  return pageData("contacts.view", "/contacts", async (actor) => {
    const store = getStore();

    return (
      <DashboardShell>
        <ContactsWorkspace
          customers={scopeByOutlet(actor, store.customers, (customer) => customer.outletId)}
          // Supplier records belong to purchasing and stock staff; sales roles only work with customers.
          suppliers={canAny(actor, ["purchase.view", "stock.view"]) ? store.suppliers : null}
          outlets={outlets.filter((outlet) => outlet.type !== "WAREHOUSE").map((outlet) => ({ id: outlet.id, name: outlet.name }))}
          scope={actor.outletId ? outletName(actor.outletId) : undefined}
          canManage={can(actor, "contacts.manage")}
          canAddSupplier={canAny(actor, ["purchase.create", "purchase.approve"])}
          canVerify={can(actor, "purchase.approve") || can(actor, "audit.view")}
        />
      </DashboardShell>
    );
  });
}
