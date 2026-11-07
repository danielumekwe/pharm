// Point of sale support: the till catalogue, held / draft baskets, receipts and the sales history read model.

import { batches, outlets, products } from "@/lib/data";
import { describeBreakdown, packagePrice } from "@/lib/erp/packaging";
import {
  assertCan,
  assertOutletAccess,
  daysToExpiry,
  DomainError,
  isBatchBlocked,
  isSellableLifecycle,
  outletName,
  productPackaging,
  recordAudit,
  saleTenders,
  sellableQuantity,
  visibleSales,
} from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor, HeldSale, SaleInvoice } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";
import { newId } from "@/lib/erp/ids";

/** Outlets where the actor may sell: their active outlet, or (central roles) any retail outlet. */
export function posOutlets(actor: Actor) {
  const retail = outlets.filter((outlet) => outlet.type !== "WAREHOUSE" && (outlet.status ?? "ACTIVE") === "ACTIVE");
  if (isOutletScoped(actor.role)) return retail.filter((outlet) => outlet.id === actor.outletId && actor.outletIds.includes(outlet.id));
  return actor.outletId ? retail.filter((outlet) => outlet.id === actor.outletId) : retail;
}

/** Everything the till needs to sell at one outlet, priced and batch-checked on the server. */
export function posCatalog(actor: Actor, outletId: string) {
  assertCan(actor, "sales.create");
  assertOutletAccess(actor, outletId);
  const now = Date.now();
  return products
    .filter((product) => product.outletId === outletId && product.status !== "RESTRICTED" && isSellableLifecycle(product))
    .map((product) => {
      const usable = batches
        .filter((batch) => batch.productId === product.id && batch.assignedOutletId === outletId && batch.availableQuantity > 0 && !isBatchBlocked(batch, now))
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.receivingDate.localeCompare(b.receivingDate));
      const levels = productPackaging(product);
      return {
        id: product.id,
        name: product.name,
        sku: product.sku ?? "",
        genericName: product.genericName,
        strength: product.strength,
        category: product.category,
        dosageForm: product.dosageForm ?? "",
        baseUnit: product.baseUnit || product.uom,
        rxOnly: Boolean(product.rxOnly),
        controlled: Boolean(product.controlled),
        available: sellableQuantity(product.id, outletId),
        minStock: product.minStock,
        barcodes: [product.barcode, ...(product.barcodes ?? []).map((row) => row.code)].filter(Boolean),
        // FEFO order: the first batch is the one the next sale draws from.
        batches: usable.map((batch) => ({ batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, days: daysToExpiry(batch, now), quantity: batch.availableQuantity })),
        packaging: levels
          .filter((level) => level.sellable)
          .map((level) => ({
            id: level.id,
            name: level.name,
            unitsPerPackage: level.unitsPerPackage,
            price: packagePrice(level, product, "sellingPrice") ?? product.sellingPrice * level.unitsPerPackage,
            minPrice: packagePrice(level, product, "minSellingPrice") ?? null,
            barcodes: (product.barcodes ?? []).filter((row) => row.packagingId === level.id || (level.isBase && !row.packagingId)).map((row) => row.code),
          })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PosCatalogItem = ReturnType<typeof posCatalog>[number];

// ---------------------------------------------------------------- held / draft baskets

export type HeldInput = { id?: string; kind: HeldSale["kind"]; outletId: string; label?: string; cart: HeldSale["cart"] };

export function heldSalesFor(actor: Actor, outletId?: string | null) {
  const rows = getStore().heldSales.filter((row) => (!outletId || row.outletId === outletId) && (!isOutletScoped(actor.role) || actor.outletIds.includes(row.outletId)));
  // Cashiers see their own parked baskets; supervisors see the whole outlet's.
  return can(actor, "sales.supervise") ? rows : rows.filter((row) => row.cashierId === actor.id);
}

export function saveHeldSale(actor: Actor, input: HeldInput) {
  assertCan(actor, "sales.create");
  assertOutletAccess(actor, input.outletId);
  if (!outlets.some((outlet) => outlet.id === input.outletId)) throw new DomainError("Unknown outlet.");
  if (input.cart.lines.length === 0) throw new DomainError("The basket is empty.");
  for (const line of input.cart.lines) {
    if (!products.some((product) => product.id === line.productId && product.outletId === input.outletId)) throw new DomainError("A basket item is not stocked at this outlet.");
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new DomainError("Basket quantities must be whole numbers.");
  }
  const store = getStore();
  const now = new Date().toISOString();
  if (input.id) {
    const existing = store.heldSales.find((row) => row.id === input.id);
    if (!existing) throw new DomainError("That held basket no longer exists.", 404);
    if (existing.cashierId !== actor.id && !can(actor, "sales.supervise")) throw new DomainError("You can only update your own held baskets.", 403);
    Object.assign(existing, { kind: input.kind, label: input.label?.trim() || existing.label, cart: input.cart, updatedAt: now });
    return existing;
  }
  const held: HeldSale = {
    id: newId("held", `${Date.now().toString(36)}-${nextNumber("held")}`),
    reference: `${input.kind === "DRAFT" ? "DRF" : "HLD"}-${String(nextNumber("heldRef")).padStart(5, "0")}`,
    kind: input.kind,
    outletId: input.outletId,
    cashierId: actor.id,
    cashierName: actor.name,
    createdAt: now,
    updatedAt: now,
    label: input.label?.trim() || undefined,
    cart: input.cart,
  };
  store.heldSales.unshift(held);
  recordAudit(actor, { action: input.kind === "DRAFT" ? "sale.draft" : "sale.hold", entity: "HeldSale", entityId: held.id, summary: `${held.reference}: ${input.cart.lines.length} line(s) ${input.kind === "DRAFT" ? "saved as draft" : "held"}${held.label ? ` (${held.label})` : ""}`, outletId: input.outletId });
  return held;
}

export function discardHeldSale(actor: Actor, id: string) {
  assertCan(actor, "sales.create");
  const store = getStore();
  const index = store.heldSales.findIndex((row) => row.id === id);
  if (index < 0) throw new DomainError("That held basket no longer exists.", 404);
  const held = store.heldSales[index];
  assertOutletAccess(actor, held.outletId);
  if (held.cashierId !== actor.id && !can(actor, "sales.supervise")) throw new DomainError("You can only discard your own held baskets.", 403);
  store.heldSales.splice(index, 1);
  recordAudit(actor, { action: "sale.discard-held", entity: "HeldSale", entityId: id, summary: `${held.reference} discarded`, outletId: held.outletId });
  return { discarded: held.reference };
}

// ---------------------------------------------------------------- receipts

function findVisibleSale(actor: Actor, saleId: string) {
  const sale = getStore().sales.find((row) => row.id === saleId || row.number === saleId);
  if (!sale) throw new DomainError("Sale not found.", 404);
  if (!visibleSales(actor).includes(sale)) throw new DomainError("You cannot view this sale.", 403);
  return sale;
}

/** Receipt content. Printing again after the first print counts as a reprint and is audited. */
export function saleReceipt(actor: Actor, saleId: string, options: { print?: boolean } = {}) {
  assertCan(actor, "sales.view");
  const sale = findVisibleSale(actor, saleId);
  if (options.print) {
    const reprint = (sale.receiptPrints ?? 0) > 0;
    sale.receiptPrints = (sale.receiptPrints ?? 0) + 1;
    if (reprint) recordAudit(actor, { action: "sale.reprint", entity: "SaleInvoice", entityId: sale.id, summary: `Receipt ${sale.number} reprinted (copy ${sale.receiptPrints})`, outletId: sale.outletId });
  }
  const outlet = outlets.find((row) => row.id === sale.outletId);
  const settings = getStore().settings;
  const returns = getStore().saleReturns.filter((row) => row.saleId === sale.id);
  return {
    business: { name: settings.businessName, logo: settings.logoFile ? "/api/branding/logo" : null },
    outlet: { name: outlet?.name ?? sale.outletId, address: outlet?.address ?? "", phone: outlet?.phone ?? "", pcnLicense: outlet?.pcnLicense ?? "" },
    sale,
    tenders: saleTenders(sale),
    returns: returns.map((row) => ({ number: row.number, date: row.date, total: row.total })),
    copy: sale.receiptPrints ?? 0,
    vatRate: settings.vatRate,
  };
}

export type Receipt = ReturnType<typeof saleReceipt>;

// ---------------------------------------------------------------- sales history

/** Default sales-history window: the last 30 days. */
export function defaultHistoryRange() {
  return { from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
}

export type HistoryFilters = { from?: string; to?: string; outletId?: string; cashierId?: string; method?: string; status?: string };

/** Sales history rows with gross, discount, returns and net per invoice. Voided invoices never count as sales. */
export function salesHistory(actor: Actor, filters: HistoryFilters = {}) {
  assertCan(actor, "sales.view");
  const returnsBySale = new Map<string, number>();
  for (const row of getStore().saleReturns) returnsBySale.set(row.saleId, (returnsBySale.get(row.saleId) ?? 0) + row.net);
  const rows = visibleSales(actor)
    .filter((sale) => (!filters.from || sale.date.slice(0, 10) >= filters.from) && (!filters.to || sale.date.slice(0, 10) <= filters.to))
    .filter((sale) => !filters.outletId || sale.outletId === filters.outletId)
    .filter((sale) => !filters.cashierId || sale.cashierId === filters.cashierId)
    .filter((sale) => !filters.method || saleTenders(sale).some((row) => row.method === filters.method))
    .filter((sale) => !filters.status || sale.status === filters.status)
    .map((sale) => historyRow(sale, returnsBySale.get(sale.id) ?? 0));
  const completed = rows.filter((row) => row.status !== "Voided");
  return {
    rows,
    totals: {
      transactions: completed.length,
      gross: round2(completed.reduce((sum, row) => sum + row.gross, 0)),
      discount: round2(completed.reduce((sum, row) => sum + row.discount, 0)),
      returns: round2(completed.reduce((sum, row) => sum + row.returns, 0)),
      net: round2(completed.reduce((sum, row) => sum + row.net, 0)),
      voided: rows.length - completed.length,
    },
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function historyRow(sale: SaleInvoice, returns: number) {
  return {
    id: sale.id,
    number: sale.number,
    date: sale.date,
    customer: sale.customerName,
    cashier: sale.cashier,
    cashierId: sale.cashierId ?? "",
    outletId: sale.outletId,
    outlet: outletName(sale.outletId),
    items: sale.lines.length,
    units: sale.lines.reduce((sum, line) => sum + line.quantity, 0),
    gross: sale.subtotal,
    discount: sale.discount,
    returns: round2(returns),
    // Net of discounts and returns, before VAT (matches the sales reports).
    net: sale.status === "Voided" ? 0 : round2(sale.subtotal - sale.discount - returns),
    total: sale.total,
    amountPaid: sale.amountPaid,
    methods: saleTenders(sale).map((row) => row.method),
    paymentLabel: sale.payments?.length ? sale.payments.map((row) => (row.method === "Card" ? "POS" : row.method)).join(" + ") : sale.paymentMethod === "Card" ? "POS" : sale.paymentMethod,
    status: sale.status,
    prescriptionRef: sale.prescriptionRef ?? "",
  };
}

export type HistoryRow = ReturnType<typeof historyRow>;

// ---------------------------------------------------------------- read-only stock levels (sales roles)

/** Quantity left per item at the viewer's outlet(s). Read-only: no costs, batches or actions. */
export function stockLevels(actor: Actor) {
  if (!can(actor, "stock.levels") && !can(actor, "stock.view")) throw new DomainError("Your role cannot see stock levels.", 403);
  const now = Date.now();
  const visible = isOutletScoped(actor.role) ? products.filter((product) => actor.outletIds.includes(product.outletId) && (!actor.outletId || product.outletId === actor.outletId)) : products.filter((product) => !actor.outletId || product.outletId === actor.outletId);
  return visible
    .filter((product) => (product.lifecycle ?? "ACTIVE") !== "DISCONTINUED")
    .map((product) => {
      const available = sellableQuantity(product.id, product.outletId);
      const levels = productPackaging(product);
      const nextExpiry = batches
        .filter((batch) => batch.productId === product.id && batch.availableQuantity > 0 && !isBatchBlocked(batch, now))
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0]?.expiryDate;
      return {
        id: product.id,
        name: product.name,
        strength: product.strength,
        category: product.category,
        outlet: outletName(product.outletId),
        outletId: product.outletId,
        unit: product.baseUnit || product.uom,
        available,
        packs: levels.length > 1 ? describeBreakdown(available, levels) : "",
        status: product.status === "RESTRICTED" || product.lifecycle === "INACTIVE" ? "Not for sale" : available <= 0 ? "Out of stock" : available <= product.minStock ? "Low stock" : "In stock",
        rxOnly: Boolean(product.rxOnly),
        nextExpiry: nextExpiry ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type StockLevelRow = ReturnType<typeof stockLevels>[number];
