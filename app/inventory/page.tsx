import { DashboardShell } from "@/components/dashboard-shell";
import { batches, products, stockMovements } from "@/lib/data";
import { packagePrice } from "@/lib/erp/packaging";
import { daysToExpiry, isBatchBlocked, isExpired, outletName, productPackaging, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { ReceivingWorkspace } from "./receiving-workspace";

export default async function InventoryPage() {
  return pageData("stock.view", "/inventory", async (actor) => {
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
        state: batch.availableQuantity === 0 ? "Depleted" : isExpired(batch) ? "Expired" : isBatchBlocked(batch) ? "Quarantined" : days <= store.settings.nearExpiryDays ? "Near expiry" : "Healthy",
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
            .filter((product) => product.lifecycle !== "DISCONTINUED")
            .map((product) => ({
              id: product.id,
              name: product.name,
              location: outletName(product.outletId),
              cost: product.purchasePrice,
              barcodes: [product.barcode, ...(product.barcodes ?? []).map((row) => row.code)].filter(Boolean),
              packaging: productPackaging(product).map((level) => ({
                id: level.id,
                name: level.name,
                unitsPerPackage: level.unitsPerPackage,
                cost: packagePrice(level, product, "purchasePrice") ?? product.purchasePrice * level.unitsPerPackage,
                barcodes: (product.barcodes ?? []).filter((row) => row.packagingId === level.id || (level.isBase && !row.packagingId)).map((row) => row.code),
              })),
            }))}
          suppliers={store.suppliers.filter((supplier) => supplier.status === "Approved").map((supplier) => ({ id: supplier.id, name: supplier.name }))}
          scope={actor.outletId ? outletName(actor.outletId) : undefined}
          permissions={{ receive: can(actor, "purchase.receive"), destroy: can(actor, "stock.request") }}
        />
      </DashboardShell>
    );
  });
}
