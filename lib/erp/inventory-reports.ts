// Inventory monitoring reports, computed from batch-level records on the server.

import { batches, outlets, products } from "@/lib/data";
import { availableUnits, expiryWindow, stockPosition } from "@/lib/erp/alerts";
import { daysToExpiry, DomainError, isExpired, outletName } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";

export const INVENTORY_REPORTS = {
  "low-stock": { title: "Low-stock products", description: "Products at or below their minimum at each outlet, with suggested reorder quantities." },
  expired: { title: "Expired products", description: "Expired batches still holding stock, with handling status. Blocked from sale and issue." },
  "near-expiry": { title: "Products approaching expiry", description: "In-date batches inside the configured expiry warning windows." },
  shortages: { title: "Stock shortages by outlet", description: "Shortage count, critical lines and replenishment value per outlet." },
  "expired-value": { title: "Expired stock value", description: "Cost value of expired stock by outlet and product." },
  replenishment: { title: "Stock replenishment requirements", description: "What to order or transfer to bring each low line back to its target level." },
} as const;

export type InventoryReportKind = keyof typeof INVENTORY_REPORTS;
export type ColumnType = "text" | "number" | "money" | "date" | "percent";
export type ReportColumn = { key: string; header: string; type: ColumnType };
export type ReportRow = Record<string, string | number>;

export type InventoryReportFilters = { outletId?: string | null; product?: string; batch?: string; from?: string; to?: string };

export function isReportKind(value: unknown): value is InventoryReportKind {
  return typeof value === "string" && value in INVENTORY_REPORTS;
}

/** Outlets the actor may report on, honouring consolidated-report permission. */
function reportOutlets(actor: Actor, requested: string | null | undefined) {
  const consolidated = can(actor, "reports.consolidated") && !isOutletScoped(actor.role);
  const allowed = consolidated ? outlets.map((outlet) => outlet.id) : actor.outletIds;
  if (requested) {
    if (!allowed.includes(requested)) throw new DomainError("You cannot report on that outlet.", 403);
    return [requested];
  }
  if (!consolidated) return actor.outletId ? [actor.outletId] : allowed.slice(0, 1);
  return allowed;
}

export function buildInventoryReport(actor: Actor, kind: InventoryReportKind, filters: InventoryReportFilters) {
  if (!can(actor, "reports.inventory") && !can(actor, "alerts.manage")) throw new DomainError("Your role cannot run inventory reports.", 403);
  const scope = reportOutlets(actor, filters.outletId);
  const inScope = (id: string) => scope.includes(id);
  const productQuery = filters.product?.trim().toLowerCase() ?? "";
  const batchQuery = filters.batch?.trim().toLowerCase() ?? "";
  const matchesProduct = (name: string) => !productQuery || name.toLowerCase().includes(productQuery);
  const matchesBatch = (number: string) => !batchQuery || number.toLowerCase().includes(batchQuery);
  const inDateRange = (date: string) => (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  const now = Date.now();
  const short = (id: string) => outletName(id);

  let columns: ReportColumn[] = [];
  let rows: ReportRow[] = [];

  const lowLines = () =>
    products
      .filter((product) => inScope(product.outletId) && product.status !== "RESTRICTED" && product.minStock > 0 && matchesProduct(product.name))
      .map((product) => ({ product, position: stockPosition(product, now) }))
      .filter(({ position }) => position.low);

  const expiredBatches = () =>
    batches.filter((batch) => inScope(batch.assignedOutletId) && batch.availableQuantity > 0 && isExpired(batch, now) && matchesProduct(batch.productName) && matchesBatch(batch.batchNumber) && inDateRange(batch.expiryDate));

  switch (kind) {
    case "low-stock": {
      columns = [
        { key: "product", header: "Product", type: "text" },
        { key: "outlet", header: "Outlet", type: "text" },
        { key: "available", header: "Available", type: "number" },
        { key: "minimum", header: "Minimum", type: "number" },
        { key: "onOrder", header: "On order", type: "number" },
        { key: "suggested", header: "Suggested reorder", type: "number" },
        { key: "level", header: "Level", type: "text" },
      ];
      rows = lowLines()
        .map(({ product, position }) => ({
          product: product.name,
          outlet: short(product.outletId),
          available: position.available,
          minimum: product.minStock,
          onOrder: position.onOrder,
          suggested: position.suggested,
          level: position.available === 0 ? "Out of stock" : position.critical ? "Critical" : "Low",
        }))
        .sort((a, b) => a.available / Math.max(1, a.minimum) - b.available / Math.max(1, b.minimum));
      break;
    }
    case "expired": {
      columns = [
        { key: "product", header: "Product", type: "text" },
        { key: "batch", header: "Batch", type: "text" },
        { key: "expiry", header: "Expiry date", type: "date" },
        { key: "overdue", header: "Days expired", type: "number" },
        { key: "quantity", header: "Remaining qty", type: "number" },
        { key: "outlet", header: "Outlet", type: "text" },
        { key: "value", header: "Inventory value", type: "money" },
        { key: "status", header: "Handling status", type: "text" },
      ];
      rows = expiredBatches()
        .map((batch) => ({
          product: batch.productName,
          batch: batch.batchNumber,
          expiry: batch.expiryDate,
          overdue: -daysToExpiry(batch, now),
          quantity: batch.availableQuantity,
          outlet: short(batch.assignedOutletId),
          value: batch.availableQuantity * batch.purchasePrice,
          status: (batch.disposition?.status ?? "NOT QUARANTINED").replace(/_/g, " "),
        }))
        .sort((a, b) => b.value - a.value);
      break;
    }
    case "near-expiry": {
      columns = [
        { key: "product", header: "Product", type: "text" },
        { key: "batch", header: "Batch", type: "text" },
        { key: "expiry", header: "Expiry date", type: "date" },
        { key: "days", header: "Days left", type: "number" },
        { key: "window", header: "Warning window", type: "text" },
        { key: "quantity", header: "Remaining qty", type: "number" },
        { key: "outlet", header: "Outlet", type: "text" },
        { key: "value", header: "Inventory value", type: "money" },
      ];
      rows = batches
        .filter((batch) => inScope(batch.assignedOutletId) && batch.availableQuantity > 0 && !isExpired(batch, now) && matchesProduct(batch.productName) && matchesBatch(batch.batchNumber) && inDateRange(batch.expiryDate))
        .map((batch) => ({ batch, days: daysToExpiry(batch, now) }))
        .map(({ batch, days }) => ({ batch, days, window: expiryWindow(days) }))
        .filter(({ window }) => window !== null)
        .map(({ batch, days, window }) => ({
          product: batch.productName,
          batch: batch.batchNumber,
          expiry: batch.expiryDate,
          days,
          window: `≤ ${window} days`,
          quantity: batch.availableQuantity,
          outlet: short(batch.assignedOutletId),
          value: batch.availableQuantity * batch.purchasePrice,
        }))
        .sort((a, b) => a.days - b.days);
      break;
    }
    case "shortages": {
      columns = [
        { key: "outlet", header: "Outlet", type: "text" },
        { key: "lines", header: "Products monitored", type: "number" },
        { key: "low", header: "Below minimum", type: "number" },
        { key: "critical", header: "Critical", type: "number" },
        { key: "out", header: "Out of stock", type: "number" },
        { key: "units", header: "Shortage units", type: "number" },
        { key: "cost", header: "Replenishment cost", type: "money" },
      ];
      const lines = lowLines();
      rows = scope.map((outletId) => {
        const mine = lines.filter(({ product }) => product.outletId === outletId);
        return {
          outlet: short(outletId),
          lines: products.filter((product) => product.outletId === outletId && product.minStock > 0 && matchesProduct(product.name)).length,
          low: mine.length,
          critical: mine.filter(({ position }) => position.critical).length,
          out: mine.filter(({ position }) => position.available === 0).length,
          units: mine.reduce((sum, { position }) => sum + position.shortage, 0),
          cost: mine.reduce((sum, { product, position }) => sum + position.suggested * product.purchasePrice, 0),
        };
      });
      break;
    }
    case "expired-value": {
      columns = [
        { key: "outlet", header: "Outlet", type: "text" },
        { key: "product", header: "Product", type: "text" },
        { key: "batches", header: "Batches", type: "number" },
        { key: "quantity", header: "Units", type: "number" },
        { key: "value", header: "Cost value", type: "money" },
        { key: "share", header: "Share of total", type: "percent" },
      ];
      const groups = new Map<string, { outlet: string; product: string; batches: number; quantity: number; value: number }>();
      for (const batch of expiredBatches()) {
        const key = `${batch.assignedOutletId}|${batch.productName}`;
        const row = groups.get(key) ?? { outlet: short(batch.assignedOutletId), product: batch.productName, batches: 0, quantity: 0, value: 0 };
        row.batches += 1;
        row.quantity += batch.availableQuantity;
        row.value += batch.availableQuantity * batch.purchasePrice;
        groups.set(key, row);
      }
      const total = [...groups.values()].reduce((sum, row) => sum + row.value, 0);
      rows = [...groups.values()].map((row) => ({ ...row, share: total ? Math.round((row.value / total) * 1000) / 10 : 0 })).sort((a, b) => b.value - a.value);
      break;
    }
    case "replenishment": {
      columns = [
        { key: "product", header: "Product", type: "text" },
        { key: "outlet", header: "Outlet", type: "text" },
        { key: "available", header: "Available", type: "number" },
        { key: "target", header: "Target level", type: "number" },
        { key: "onOrder", header: "On order", type: "number" },
        { key: "suggested", header: "Order / transfer qty", type: "number" },
        { key: "unitCost", header: "Unit cost", type: "money" },
        { key: "cost", header: "Est. cost", type: "money" },
        { key: "source", header: "Suggested source", type: "text" },
      ];
      const warehouses = outlets.filter((outlet) => outlet.type === "WAREHOUSE" && outlet.status !== "CLOSED").map((outlet) => outlet.id);
      rows = lowLines()
        .filter(({ position }) => position.suggested > 0)
        .map(({ product, position }) => {
          // Prefer a warehouse transfer when the warehouse has enough in-date stock; otherwise a PO to the last supplier.
          const warehouseItem = products.find((row) => row.name === product.name && warehouses.includes(row.outletId) && row.outletId !== product.outletId);
          const warehouseQty = warehouseItem ? availableUnits(warehouseItem.id, warehouseItem.outletId, now) : 0;
          const lastSupplier = batches.filter((batch) => batch.productName === product.name).sort((a, b) => b.receivingDate.localeCompare(a.receivingDate))[0]?.supplier;
          return {
            product: product.name,
            outlet: short(product.outletId),
            available: position.available,
            target: position.target,
            onOrder: position.onOrder,
            suggested: position.suggested,
            unitCost: product.purchasePrice,
            cost: position.suggested * product.purchasePrice,
            source: warehouseQty >= position.suggested ? `Transfer from ${short(warehouseItem!.outletId)} (${warehouseQty} available)` : `PO to ${lastSupplier ?? "approved supplier"}`,
          };
        })
        .sort((a, b) => b.cost - a.cost);
      break;
    }
  }

  const totals: ReportRow = {};
  for (const column of columns) {
    if ((column.type === "money" || column.type === "number") && !["days", "overdue", "minimum", "target", "available", "unitCost"].includes(column.key)) {
      totals[column.key] = rows.reduce((sum, row) => sum + Number(row[column.key] ?? 0), 0);
    }
  }

  const filterParts = [
    filters.product ? `product “${filters.product}”` : null,
    filters.batch ? `batch “${filters.batch}”` : null,
    filters.from || filters.to ? `expiry ${filters.from ?? "…"} to ${filters.to ?? "…"}` : null,
  ].filter(Boolean);

  return {
    kind,
    ...INVENTORY_REPORTS[kind],
    scopeLabel: scope.length === outlets.length ? "All outlets" : scope.map(short).join(", "),
    filtersLabel: filterParts.length ? filterParts.join(" · ") : "No filters",
    generatedAt: new Date(now).toISOString(),
    generatedBy: actor.name,
    businessName: getStore().settings.businessName,
    columns,
    rows,
    totals,
  };
}

export type InventoryReport = ReturnType<typeof buildInventoryReport>;
