import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { getSalesKpis, getSellableCatalog, outletName, scopeByOutlet } from "@/lib/erp/services";
import { returnedQuantities } from "@/lib/erp/returns";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { SalesWorkspace } from "./sales-workspace";

export default async function SalesPage() {
  const actor = await requirePage("sales.view", "/sales");
  const store = getStore();
  const sales = scopeByOutlet(actor, store.sales, (sale) => sale.outletId);
  const retail = scopeByOutlet(
    actor,
    outlets.filter((outlet) => outlet.type !== "WAREHOUSE"),
    (outlet) => outlet.id,
  );

  return (
    <DashboardShell>
      <SalesWorkspace
        totalCount={sales.length}
        vatRate={store.settings.vatRate}
        sales={sales.slice(0, 500)}
        returned={Object.fromEntries(store.saleReturns.filter((row) => sales.some((sale) => sale.id === row.saleId)).map((row) => [row.saleId, returnedQuantities(row.saleId)]))}
        kpis={getSalesKpis(sales)}
        outlets={retail.map((outlet) => ({ id: outlet.id, name: outlet.name }))}
        catalog={Object.fromEntries(retail.map((outlet) => [outlet.id, getSellableCatalog(outlet.id)]))}
        customers={scopeByOutlet(actor, store.customers, (customer) => customer.outletId).map((customer) => ({
          id: customer.id,
          name: customer.name,
          type: customer.type,
          status: customer.status,
          available: Math.max(0, customer.creditLimit - customer.balance),
        }))}
        scope={actor.outletId ? outletName(actor.outletId) : undefined}
        canCreate={can(actor, "sales.create")}
        canVoid={can(actor, "sales.void")}
      />
    </DashboardShell>
  );
}
