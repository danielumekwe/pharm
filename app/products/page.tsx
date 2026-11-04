import { DashboardShell } from "@/components/dashboard-shell";
import { outlets, products } from "@/lib/data";
import { ITEM_CATEGORIES } from "@/lib/erp/inventory";
import { outletName, scopeByOutlet, sellableQuantity } from "@/lib/erp/services";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { ItemsWorkspace } from "./items-workspace";

export default async function ProductsPage() {
  const actor = await requirePage("products.view", "/products");

  const items = scopeByOutlet(actor, products, (product) => product.outletId).map((product) => ({
    id: product.id,
    name: product.name,
    genericName: product.genericName,
    category: product.category,
    manufacturer: product.manufacturer,
    strength: product.strength,
    uom: product.uom,
    purchasePrice: product.purchasePrice,
    sellingPrice: product.sellingPrice,
    minStock: product.minStock,
    stock: product.stock,
    sellable: sellableQuantity(product.id, product.outletId),
    status: product.status,
    barcode: product.barcode,
    nafdacNumber: product.nafdacNumber,
    outletId: product.outletId,
    rxOnly: Boolean(product.rxOnly),
    controlled: Boolean(product.controlled),
    locations: products.filter((other) => other.name === product.name).length,
  }));

  return (
    <DashboardShell>
      <ItemsWorkspace
        items={items}
        categories={[...ITEM_CATEGORIES]}
        locations={scopeByOutlet(actor, outlets, (outlet) => outlet.id).map((outlet) => ({ id: outlet.id, name: outlet.name }))}
        scope={actor.outletId ? outletName(actor.outletId) : undefined}
        permissions={{
          manage: can(actor, "products.manage"),
          restrict: actor.role === "SUPER_ADMIN" || actor.role === "PHARMACY_MANAGER",
          network: !actor.outletId,
        }}
      />
    </DashboardShell>
  );
}
