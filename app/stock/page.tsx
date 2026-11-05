import { DashboardShell } from "@/components/dashboard-shell";
import { batches, outlets, products, stockMovements } from "@/lib/data";
import { LEDGER_LABELS } from "@/lib/erp/ledger";
import { daysToExpiry, isBatchBlocked, isExpired, outletName, scopeByOutlet, sellableQuantity } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { can, isOutletScoped } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { StockWorkspace } from "./stock-workspace";

export default async function StockPage() {
  const actor = await requirePage("stock.view", "/stock");
  const items = scopeByOutlet(actor, products, (product) => product.outletId).map((product) => {
    const sellable = sellableQuantity(product.id, product.outletId);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      outletId: product.outletId,
      onHand: product.stock,
      sellable,
      quarantined: Math.max(0, product.stock - sellable),
      minStock: product.minStock,
      costValue: product.stock * product.purchasePrice,
      status: product.status,
      controlled: Boolean(product.controlled),
    };
  });

  const batchRows = scopeByOutlet(actor, batches, (batch) => batch.assignedOutletId).map((batch) => ({
    ...batch,
    days: daysToExpiry(batch),
    state: isExpired(batch) ? "Expired" : isBatchBlocked(batch) ? "Quarantined" : daysToExpiry(batch) <= getStore().settings.nearExpiryDays ? "Near expiry" : "Healthy",
  }));

  const movements = scopeByOutlet(actor, stockMovements, (movement) => movement.outletId).concat(
    // Outlet users also see transfers coming in to them.
    isOutletScoped(actor.role) ? stockMovements.filter((movement) => movement.toOutletId === actor.outletId && movement.outletId !== actor.outletId) : [],
  );

  return (
    <DashboardShell>
      <StockWorkspace
        items={items}
        batches={batchRows}
        movements={movements}
        ledger={scopeByOutlet(actor, getStore().stockLedger, (entry) => entry.outletId).slice(0, 2000)}
        ledgerLabels={LEDGER_LABELS}
        locations={outlets.map((outlet) => ({ id: outlet.id, name: outlet.name }))}
        actorName={actor.name}
        scope={actor.outletId ? outletName(actor.outletId) : undefined}
        permissions={{ request: can(actor, "stock.request"), approve: can(actor, "stock.approve"), superAdmin: actor.role === "SUPER_ADMIN" }}
      />
    </DashboardShell>
  );
}
