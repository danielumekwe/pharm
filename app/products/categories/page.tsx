import { DashboardShell } from "@/components/dashboard-shell";
import { products } from "@/lib/data";
import { catalogLists } from "@/lib/erp/products";
import { scopeByOutlet } from "@/lib/erp/services";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { CategoriesEditor } from "./categories-editor";

export default async function CategoriesPage() {
  const actor = await requirePage("products.view", "/products/categories");
  const catalog = catalogLists();
  const scoped = scopeByOutlet(actor, products, (product) => product.outletId);
  const usage = (field: "category" | "dosageForm" | "productType") =>
    Object.fromEntries(Array.from(new Set(scoped.map((product) => product[field]).filter(Boolean) as string[])).map((value) => [value, new Set(scoped.filter((product) => product[field] === value).map((product) => product.name)).size]));
  return (
    <DashboardShell>
      <CategoriesEditor catalog={catalog} usage={{ categories: usage("category"), dosageForms: usage("dosageForm"), productTypes: usage("productType"), packagingTypes: {} }} canEdit={can(actor, "catalog.manage")} />
    </DashboardShell>
  );
}
