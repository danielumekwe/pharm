import { DashboardShell } from "@/components/dashboard-shell";
import { products } from "@/lib/data";
import { daysToExpiry, getCompliance, outletName } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { requirePage } from "@/lib/session";

import { AuditWorkspace } from "./audit-workspace";

export default async function AuditPage() {
  await requirePage("audit.view", "/audit");
  const store = getStore();
  const compliance = getCompliance();
  const controlledIds = new Set(compliance.controlledProducts.map((product) => product.id));

  const controlledRegister = store.sales
    .filter((sale) => sale.lines.some((line) => controlledIds.has(line.productId)))
    .slice(0, 50)
    .map((sale) => ({
      id: sale.id,
      date: sale.date,
      document: sale.number,
      outlet: outletName(sale.outletId),
      patient: sale.customerName,
      prescription: sale.prescriptionRef ?? "MISSING",
      detail: sale.lines.filter((line) => controlledIds.has(line.productId)).map((line) => `${line.quantity} × ${line.productName}`).join(", "),
      status: sale.status,
    }));

  const batchRow = (batch: (typeof compliance.expired)[number]) => ({
    id: batch.id,
    batchNumber: batch.batchNumber,
    productName: batch.productName,
    outlet: outletName(batch.assignedOutletId),
    expiryDate: batch.expiryDate,
    days: daysToExpiry(batch),
    quantity: batch.availableQuantity,
    value: batch.availableQuantity * batch.purchasePrice,
  });

  return (
    <DashboardShell>
      <AuditWorkspace
        events={store.audit.map((event) => ({ ...event, outlet: outletName(event.outletId) }))}
        expired={compliance.expired.map(batchRow)}
        nearExpiry={compliance.nearExpiry.map(batchRow)}
        quarantineValue={compliance.quarantineValue}
        controlledRegister={controlledRegister}
        controlledStock={compliance.controlledProducts.map((product) => ({ id: product.id, name: product.name, outlet: outletName(product.outletId), stock: product.stock }))}
        unregistered={compliance.unregistered.map((product) => ({ id: product.id, name: product.name, manufacturer: product.manufacturer, outlet: outletName(product.outletId) }))}
        unverifiedSuppliers={compliance.unverifiedSuppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, status: supplier.status, pcn: supplier.pcnLicense }))}
        rxItems={products.filter((product) => product.rxOnly).length}
      />
    </DashboardShell>
  );
}
