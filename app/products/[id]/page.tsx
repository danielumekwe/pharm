import { notFound } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { LEDGER_LABELS } from "@/lib/erp/ledger";
import { catalogLists, productDetail } from "@/lib/erp/products";
import { DomainError, outletName } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { ProductDetail } from "./product-detail";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePage("products.view", `/products/${id}`);
  let detail;
  try {
    detail = productDetail(actor, id);
  } catch (cause) {
    if (cause instanceof DomainError) notFound();
    throw cause;
  }
  return (
    <DashboardShell>
      <ProductDetail
        detail={JSON.parse(JSON.stringify(detail))}
        catalog={catalogLists()}
        suppliers={getStore().suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        outletLabels={Object.fromEntries(outlets.map((outlet) => [outlet.id, outletName(outlet.id)]))}
        ledgerLabels={LEDGER_LABELS}
        permissions={{
          manage: can(actor, "products.manage"),
          price: can(actor, "products.manage") && can(actor, "products.price"),
          quarantine: can(actor, "alerts.manage"),
          destroy: can(actor, "stock.request"),
          stockView: can(actor, "stock.view"),
          regulatory: can(actor, "regulatory.manage"),
        }}
      />
    </DashboardShell>
  );
}
