import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { catalogLists, inventoryRows } from "@/lib/erp/products";
import { outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { ItemsWorkspace } from "./items-workspace";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return pageData("products.view", "/products", async (actor) => {
    const { q } = await searchParams;
    const { nearExpiryDays } = getStore().settings;
    const items = inventoryRows(actor);

    return (
      <DashboardShell>
        <ItemsWorkspace
          items={items}
          catalog={catalogLists()}
          nearExpiryDays={nearExpiryDays}
          locations={scopeByOutlet(actor, outlets, (outlet) => outlet.id).map((outlet) => ({ id: outlet.id, name: outlet.name }))}
          scope={actor.outletId ? outletName(actor.outletId) : undefined}
          activeOutletId={actor.outletId}
          initialQuery={typeof q === "string" ? q : ""}
          permissions={{
            manage: can(actor, "products.manage"),
            price: can(actor, "products.price"),
            restrict: actor.role === "SUPER_ADMIN" || actor.role === "PHARMACY_MANAGER",
            network: !actor.outletId,
            catalog: can(actor, "catalog.manage"),
          }}
        />
      </DashboardShell>
    );
  });
}
