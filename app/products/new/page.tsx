import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { catalogLists } from "@/lib/erp/products";
import { outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { REGISTRATION_STATUSES } from "@/lib/erp/types";
import { can } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { ProductForm } from "./product-form";

export default async function NewProductPage() {
  return pageData("products.manage", "/products/new", async (actor) => {
    const store = getStore();
    return (
      <DashboardShell>
        <ProductForm
          catalog={catalogLists()}
          outlets={scopeByOutlet(actor, outlets, (outlet) => outlet.id)
            .filter((outlet) => (outlet.status ?? "ACTIVE") === "ACTIVE")
            .map((outlet) => ({ id: outlet.id, name: outlet.name }))}
          defaultOutletId={actor.outletId}
          suppliers={store.suppliers.filter((supplier) => supplier.status !== "Suspended").map((supplier) => ({ id: supplier.id, name: supplier.name }))}
          registrationStatuses={[...REGISTRATION_STATUSES]}
          canOpenStock={can(actor, "products.manage") && can(actor, "stock.approve")}
          scope={actor.outletId ? outletName(actor.outletId) : undefined}
        />
      </DashboardShell>
    );
  });
}
