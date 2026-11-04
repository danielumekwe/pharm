import { DashboardShell } from "@/components/dashboard-shell";
import { outlets, products } from "@/lib/data";
import { outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { PurchaseWorkspace } from "./purchase-workspace";

export default async function PurchasePage() {
  const actor = await requirePage("purchase.view", "/purchase");
  const store = getStore();
  const orders = scopeByOutlet(actor, store.purchaseOrders, (order) => order.outletId);

  // One orderable line per item name (item records are per location).
  const catalog = Array.from(new Map(products.map((product) => [product.name, product])).values()).map((product) => ({
    id: product.id,
    name: product.name,
    unitCost: product.purchasePrice,
  }));

  return (
    <DashboardShell>
      <PurchaseWorkspace
        orders={orders}
        suppliers={store.suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, status: supplier.status, balance: supplier.balance }))}
        catalog={catalog}
        locations={scopeByOutlet(actor, outlets, (outlet) => outlet.id).map((outlet) => ({ id: outlet.id, name: outlet.name }))}
        actorId={actor.id}
        scope={actor.outletId ? outletName(actor.outletId) : undefined}
        permissions={{
          create: can(actor, "purchase.create"),
          approve: can(actor, "purchase.approve"),
          receive: can(actor, "purchase.receive"),
          superAdmin: actor.role === "SUPER_ADMIN",
        }}
      />
    </DashboardShell>
  );
}
