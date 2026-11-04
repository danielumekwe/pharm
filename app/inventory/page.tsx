import { DashboardShell } from "@/components/dashboard-shell";
import { batches, products, stockMovements } from "@/lib/data";
import { daysToExpiry, isExpired, outletName, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { ReceivingWorkspace } from "./receiving-workspace";

export default async function InventoryPage() {
  const actor = await requirePage("stock.view", "/inventory");
  const store = getStore();
  const pendingDestruction = new Set(stockMovements.filter((movement) => movement.status === "Pending" && movement.batchId).map((movement) => movement.batchId));

  const batchRows = scopeByOutlet(actor, batches, (batch) => batch.assignedOutletId).map((batch) => {
    const days = daysToExpiry(batch);
    return {
      id: batch.id,
      batchNumber: batch.batchNumber,
      productName: batch.productName,
      supplier: batch.supplier,
      location: outletName(batch.assignedOutletId),
      outletId: batch.assignedOutletId,
      receivingDate: batch.receivingDate,
      manufacturingDate: batch.manufacturingDate,
      expiryDate: batch.expiryDate,
      days,
      quantityReceived: batch.quantityReceived,
      availableQuantity: batch.availableQuantity,
      value: batch.availableQuantity * batch.purchasePrice,
      state: batch.availableQuantity === 0 ? "Depleted" : isExpired(batch) ? "Expired" : days <= 120 ? "Near expiry" : "Healthy",
      destructionPending: pendingDestruction.has(batch.id),
    };
  });

  const receipts = scopeByOutlet(actor, stockMovements, (movement) => movement.outletId)
    .filter((movement) => movement.type === "Receive")
    .map((movement) => ({ ...movement, location: outletName(movement.outletId), direct: movement.reference.startsWith("GRN-D") || Boolean(movement.reason?.startsWith("Direct")) }));

  const deliveries = scopeByOutlet(actor, store.purchaseOrders, (order) => order.outletId)
    .filter((order) => order.status === "Approved" || order.status === "Partially received")
    .map((order) => ({
      id: order.id,
      number: order.number,
      supplierName: order.supplierName,
      location: outletName(order.outletId),
      expectedDate: order.expectedDate,
      outstanding: order.lines.reduce((sum, line) => sum + line.quantity - line.receivedQuantity, 0),
      value: order.lines.reduce((sum, line) => sum + (line.quantity - line.receivedQuantity) * line.unitCost, 0),
      status: order.status,
    }));

  return (
    <DashboardShell>
      <ReceivingWorkspace
        batches={batchRows}
        receipts={receipts}
        deliveries={deliveries}
        items={scopeByOutlet(actor, products, (product) => product.outletId)
          .filter((product) => product.status !== "RESTRICTED")
          .map((product) => ({ id: product.id, name: product.name, location: outletName(product.outletId), cost: product.purchasePrice }))}
        suppliers={store.suppliers.filter((supplier) => supplier.status === "Approved").map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        scope={actor.outletId ? outletName(actor.outletId) : undefined}
        permissions={{ receive: can(actor, "purchase.receive"), destroy: can(actor, "stock.request") }}
      />
    </DashboardShell>
  );
}
