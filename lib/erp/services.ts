// ERP business operations. Every mutation validates permissions and business rules,
// updates linked records (stock, balances, documents) and writes an audit event.

import {
  addStockMovement,
  batches,
  outlets,
  products,
  stockMovements,
  updateStockMovementStatus,
  type BatchRecord,
  type Product,
  type StockMovement,
} from "@/lib/data";
import { issueFefo, postStock, receiveIntoNewBatch } from "@/lib/erp/ledger";
import { defaultPackaging, packagePrice } from "@/lib/erp/packaging";
import { priceBasket, PricingError } from "@/lib/erp/sale-pricing";
import { can, isOutletScoped, type Permission } from "@/lib/rbac";
import { getStore, nextNumber } from "@/lib/erp/store";
import type {
  Actor,
  AuditEvent,
  Customer,
  CustomerType,
  Expense,
  Payment,
  PaymentMethod,
  PurchaseOrder,
  SaleInvoice,
  SaleTender,
  Supplier,
  TenderMethod,
} from "@/lib/erp/types";
import { newId } from "@/lib/erp/ids";

const DAY = 1000 * 60 * 60 * 24;

/** Asks the database layer (server only, registered at startup) to save pending changes soon. */
export function requestPersist() {
  (globalThis as typeof globalThis & { __pharmDb?: { schedule(): void } }).__pharmDb?.schedule();
}

type DatabaseHooks = typeof globalThis & {
  __pharmDb?: unknown;
  __pharmTransactions?: { getStore(): unknown };
  __pharmPending?: { getStore(): Promise<unknown>[] | undefined };
};

/**
 * Whether changes made now will be committed. True inside a request/job database transaction, or when
 * no database is attached (pure in-memory use). Changes made elsewhere would be discarded on the next load.
 */
export function canPersistNow() {
  const hooks = globalThis as DatabaseHooks;
  return !hooks.__pharmDb || Boolean(hooks.__pharmTransactions?.getStore());
}

/** Async side effects (notifications) that must finish before the current transaction commits. */
export function awaitBeforeCommit(promise: Promise<unknown>) {
  const pending = (globalThis as DatabaseHooks).__pharmPending?.getStore();
  if (pending) pending.push(promise);
  else void promise.catch((error) => console.error("[erp] detached work failed", error));
}

/**
 * A refused business operation. API requests that end in a DomainError are rolled back, so a check that fails
 * halfway never leaves partial changes. Set keepChanges for refusals that must still be recorded (e.g. a
 * security audit entry for a failed password confirmation).
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
    public keepChanges = false,
  ) {
    super(message);
  }
}

export function assertCan(actor: Actor, permission: Permission) {
  if (!can(actor, permission)) {
    throw new DomainError(`Your role does not have the "${permission}" permission.`, 403);
  }
}

/**
 * Outlet roles may only act in their active outlet (which is always one of their assigned outlets).
 * Multi-outlet staff switch outlets to work elsewhere; the switch itself is validated server-side.
 */
export function assertOutletAccess(actor: Actor, outletId: string) {
  if (isOutletScoped(actor.role) && (actor.outletId !== outletId || !actor.outletIds.includes(outletId))) {
    throw new DomainError("You can only work with records for your active outlet. Switch outlet if you are assigned to it.", 403);
  }
}

/** Limits rows to the active outlet: mandatory for outlet roles, a view filter for central roles. */
export function scopeByOutlet<T>(actor: Actor, rows: T[], getOutlet: (row: T) => string | null | undefined) {
  if (!actor.outletId) return rows;
  return rows.filter((row) => {
    const outletId = getOutlet(row);
    return outletId === actor.outletId || outletId === null;
  });
}

export function outletName(outletId: string | null | undefined) {
  if (!outletId) return "All outlets";
  return outlets.find((outlet) => outlet.id === outletId)?.name ?? outletId;
}

// ---------------------------------------------------------------- audit

export function recordAudit(
  actor: Pick<Actor, "id" | "name" | "role"> & { impersonation?: Actor["impersonation"] },
  event: Pick<AuditEvent, "action" | "entity" | "entityId" | "summary"> & {
    outletId?: string | null;
    severity?: AuditEvent["severity"];
  },
) {
  const store = getStore();
  const entry: AuditEvent = {
    id: newId("aud", `${nextNumber("audit")}`),
    at: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: event.action,
    entity: event.entity,
    entityId: event.entityId,
    summary: event.summary,
    outletId: event.outletId ?? null,
    severity: event.severity ?? "info",
  };
  if (actor.impersonation) {
    // Actions taken while impersonating are attributed to both the user and the administrator.
    entry.impersonationId = actor.impersonation.sessionId;
    entry.impersonatorId = actor.impersonation.adminId;
    entry.impersonatorName = actor.impersonation.adminName;
    entry.summary = `[as ${actor.name}, by ${actor.impersonation.adminName}] ${entry.summary}`;
    const session = store.impersonations.find((row) => row.id === actor.impersonation!.sessionId);
    if (session && !session.endedAt) session.actions += 1;
  }
  store.audit.unshift(entry);
  if (store.audit.length > 20000) store.audit.length = 20000;
  requestPersist();
  return entry;
}

// ---------------------------------------------------------------- stock helpers

export function isExpired(batch: BatchRecord, now = Date.now()) {
  return new Date(batch.expiryDate).getTime() < now;
}

export function daysToExpiry(batch: BatchRecord, now = Date.now()) {
  return Math.ceil((new Date(batch.expiryDate).getTime() - now) / DAY);
}

export function refreshProductStatus(product: Product) {
  if (product.status === "RESTRICTED") return;
  product.status = product.stock <= product.minStock ? "LOW_STOCK" : "ACTIVE";
}

const BLOCKING_DISPOSITIONS = new Set(["QUARANTINED", "RETURN_PENDING", "DISPOSAL_PENDING", "RETURNED", "DISPOSED"]);

/** Expired or quarantined stock cannot be sold, issued or transferred. */
export function isBatchBlocked(batch: BatchRecord, now = Date.now()) {
  return isExpired(batch, now) || Boolean(batch.disposition && BLOCKING_DISPOSITIONS.has(batch.disposition.status));
}

/** Base units that can legally be sold: in-date, non-quarantined batches at the outlet. */
export function sellableQuantity(productId: string, outletId: string) {
  return batches
    .filter((batch) => batch.productId === productId && batch.assignedOutletId === outletId && !isBatchBlocked(batch))
    .reduce((sum, batch) => sum + batch.availableQuantity, 0);
}

export function productPackaging(product: Product) {
  return product.packaging?.length ? product.packaging : defaultPackaging(product.uom, product);
}

export function isSellableLifecycle(product: Product) {
  return (product.lifecycle ?? "ACTIVE") === "ACTIVE";
}

export function getSellableCatalog(outletId: string) {
  return products
    .filter((product) => product.outletId === outletId && product.status !== "RESTRICTED" && isSellableLifecycle(product))
    .map((product) => ({
      id: product.id,
      name: product.name,
      strength: product.strength,
      baseUnit: product.baseUnit || product.uom,
      sellingPrice: product.sellingPrice,
      rxOnly: Boolean(product.rxOnly),
      controlled: Boolean(product.controlled),
      available: sellableQuantity(product.id, outletId),
      barcodes: [product.barcode, ...(product.barcodes ?? []).map((row) => row.code)].filter(Boolean),
      packaging: productPackaging(product)
        .filter((level) => level.sellable)
        .map((level) => ({
          id: level.id,
          name: level.name,
          unitsPerPackage: level.unitsPerPackage,
          price: packagePrice(level, product, "sellingPrice") ?? product.sellingPrice * level.unitsPerPackage,
          barcodes: (product.barcodes ?? []).filter((row) => row.packagingId === level.id || (level.isBase && !row.packagingId)).map((row) => row.code),
        })),
    }));
}

// ---------------------------------------------------------------- sales

type DiscountInput = { type: "percent" | "amount"; value: number };

export type SaleInput = {
  outletId: string;
  customerId: string | null;
  /** Legacy single-method field. POS sales send `payments` instead. */
  paymentMethod?: PaymentMethod;
  amountPaid?: number;
  /** Tenders (cash, POS terminal, transfer); several make a split payment. */
  payments?: SaleTender[];
  prescriptionRef?: string;
  /** quantity is in the chosen package (packagingId), or base units when no package is given. */
  lines: { productId: string; quantity: number; packagingId?: string; discount?: number | DiscountInput }[];
  /** Transaction-level discount, applied after line discounts and shared across lines. */
  globalDiscount?: DiscountInput;
  walkIn?: { name?: string; phone?: string };
  customerKind?: "Normal" | "Family";
  /** Held or draft basket being completed (removed once the sale posts). */
  heldId?: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Shared sale arithmetic (lib/erp/sale-pricing.ts), with its errors reported as DomainErrors. */
function pricing<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof PricingError) throw new DomainError(error.message);
    throw error;
  }
}

/**
 * Posts a sale. Prices, discounts, VAT, payments and stock are all (re)calculated here from the item master,
 * never taken from the till; stock leaves FEFO through the ledger inside the request's database transaction.
 */
export type SaleOptions = {
  /** Per line: the package price charged (offline sales, already checked against the price history). */
  chargedPrices?: (number | undefined)[];
  /** When the sale happened (offline sales); defaults to now. */
  at?: string;
  /** Offline origin of the sale (device, operation, local receipt number). */
  offline?: SaleInvoice["offline"];
};

export function createSale(actor: Actor, input: SaleInput, options: SaleOptions = {}) {
  assertCan(actor, "sales.create");
  assertOutletAccess(actor, input.outletId);
  const store = getStore();

  const outlet = outlets.find((row) => row.id === input.outletId);
  if (!outlet) throw new DomainError("Unknown outlet.");
  if (outlet.type === "WAREHOUSE") throw new DomainError("Warehouses cannot make retail sales.");
  if (input.lines.length === 0) throw new DomainError("Add at least one item to the sale.");

  const customer = input.customerId ? store.customers.find((row) => row.id === input.customerId) : store.customers.find((row) => row.type === "Walk-in") ?? store.customers[0];
  if (!customer) throw new DomainError("Unknown customer.");
  if (customer.status === "On hold") throw new DomainError(`${customer.name} is on hold. Clear their account before selling.`);

  // Validate every line before mutating anything.
  const requestedUnits = new Map<string, number>();
  const prepared = input.lines.map((line, index) => {
    const product = products.find((row) => row.id === line.productId && row.outletId === input.outletId);
    if (!product) throw new DomainError("One of the items is not stocked at this outlet.");
    if (product.status === "RESTRICTED") throw new DomainError(`${product.name} is restricted and cannot be sold.`);
    if (!isSellableLifecycle(product)) throw new DomainError(`${product.name} is ${product.lifecycle?.toLowerCase()} and cannot be sold.`);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new DomainError(`Invalid quantity for ${product.name}.`);
    const levels = productPackaging(product);
    const level = line.packagingId ? levels.find((row) => row.id === line.packagingId) : levels.find((row) => row.isBase);
    if (!level) throw new DomainError(`Unknown packaging for ${product.name}.`);
    if (!level.sellable) throw new DomainError(`${product.name} is not sold by the ${level.name.toLowerCase()}.`);
    const baseQuantity = line.quantity * level.unitsPerPackage;
    // The same item may be on several lines (e.g. a strip and loose tablets): check the combined quantity.
    const units = (requestedUnits.get(product.id) ?? 0) + baseQuantity;
    requestedUnits.set(product.id, units);
    const available = sellableQuantity(product.id, input.outletId);
    if (units > available) {
      throw new DomainError(`Only ${available} sellable ${(product.baseUnit || product.uom).toLowerCase()}(s) of ${product.name} (expired and quarantined batches are blocked).`);
    }
    const listPrice = packagePrice(level, product, "sellingPrice") ?? product.sellingPrice * level.unitsPerPackage;
    // Offline sales keep the price the device charged, when it was this item's price at the time of sale.
    const charged = options.chargedPrices?.[index];
    const packPrice = charged !== undefined ? charged : listPrice;
    return { product, level, quantity: line.quantity, baseQuantity, packPrice, gross: 0, discount: 0, lineDiscount: line.discount };
  });

  // Totals: shared arithmetic (line discounts, basket discount shared across lines, VAT).
  const priced = pricing(() => priceBasket({ lines: prepared.map((row) => ({ packPrice: row.packPrice, quantity: row.quantity, discount: row.lineDiscount })), globalDiscount: input.globalDiscount, vatRate: store.settings.vatRate }));
  prepared.forEach((row, index) => {
    row.gross = priced.lines[index].gross;
    row.discount = priced.lines[index].discount;
  });
  const subtotal = priced.subtotal;
  const globalAmount = priced.globalAmount;
  for (const row of prepared) {
    const minimum = packagePrice(row.level, row.product, "minSellingPrice");
    if (minimum !== undefined && (row.gross - row.discount) / row.quantity < minimum - 0.005) {
      throw new DomainError(`${row.product.name}: the discount takes the ${row.level.name.toLowerCase()} price below the minimum of ₦${minimum.toLocaleString()}.`);
    }
  }
  const discount = priced.discount;

  // Discount limits: cashiers up to their limit; larger discounts need "sales.discount", up to the approver ceiling.
  const { cashierMaxDiscountPct, approverMaxDiscountPct } = store.settings.pos;
  const discountPct = subtotal > 0 ? (discount / subtotal) * 100 : 0;
  if (discountPct > approverMaxDiscountPct + 0.001) throw new DomainError(`Discounts are limited to ${approverMaxDiscountPct}% of the sale.`);
  if (discountPct > cashierMaxDiscountPct + 0.001 && !can(actor, "sales.discount")) {
    throw new DomainError(`Discounts above ${cashierMaxDiscountPct}% need a supervisor with discount authority.`, 403);
  }

  const needsRx = prepared.some(({ product }) => product.rxOnly);
  if (needsRx && !input.prescriptionRef?.trim()) {
    throw new DomainError("This sale contains prescription-only medicines. Enter the prescription reference.");
  }

  const vat = priced.vat;
  const total = priced.total;

  // Payments.
  let paymentMethod: PaymentMethod;
  let amountPaid: number;
  let tenders: SaleTender[] | undefined;
  let tendered: number | undefined;
  let change: number | undefined;
  if (input.payments?.length) {
    tenders = input.payments
      .filter((row) => row.amount > 0)
      .map((row) => {
        if (!["Cash", "Card", "Transfer"].includes(row.method)) throw new DomainError("Unknown payment method.");
        return { method: row.method, amount: round2(row.amount), reference: row.reference?.trim() || undefined };
      });
    if (tenders.length === 0) throw new DomainError("Enter the amount received.");
    const received = round2(tenders.reduce((sum, row) => sum + row.amount, 0));
    const cash = tenders.filter((row) => row.method === "Cash").reduce((sum, row) => sum + row.amount, 0);
    const over = round2(received - total);
    if (over > 0) {
      // Only cash can be over-tendered; the excess is change.
      if (over > cash + 0.001) throw new DomainError("Card and transfer payments cannot exceed the amount due.");
      change = over;
      tendered = round2(cash);
      let excess = over;
      tenders = tenders.map((row) => {
        if (row.method !== "Cash" || excess <= 0) return row;
        const reduce = Math.min(row.amount, excess);
        excess = round2(excess - reduce);
        return { ...row, amount: round2(row.amount - reduce) };
      }).filter((row) => row.amount > 0);
    }
    amountPaid = Math.min(received, total);
    paymentMethod = new Set(tenders.map((row) => row.method)).size > 1 ? "Split" : tenders[0].method;
  } else {
    paymentMethod = input.paymentMethod ?? "Cash";
    if (paymentMethod === "Split") throw new DomainError("Enter the amounts for a split payment.");
    const isCreditSale = paymentMethod === "Credit" || paymentMethod === "HMO";
    amountPaid = isCreditSale ? Math.max(0, Math.min(input.amountPaid ?? 0, total)) : total;
  }
  const outstanding = round2(total - amountPaid);

  if (outstanding > 0.001) {
    if (customer.type === "Walk-in") throw new DomainError(`Payment is ₦${outstanding.toLocaleString()} short. Walk-in customers must pay in full.`);
    if (customer.balance + outstanding > customer.creditLimit) {
      throw new DomainError(
        `Credit limit exceeded for ${customer.name}: ₦${(customer.balance + outstanding).toLocaleString()} of ₦${customer.creditLimit.toLocaleString()}.`,
      );
    }
  }

  const number = `INV-${String(nextNumber("sale")).padStart(5, "0")}`;
  const lines = prepared.map(({ product, level, quantity, baseQuantity, packPrice, gross, discount: lineDiscount }) => {
    const picks = issueFefo(actor, {
      type: "SALE",
      product,
      baseQuantity,
      reference: number,
      remarks: `Retail sale${level.isBase ? "" : ` (${quantity} × ${level.name})`}`,
      unit: { name: level.name, unitsPerPackage: level.unitsPerPackage },
    });

    stockMovements.unshift({
      id: newId("mov", `${nextNumber("movement")}`),
      reference: number,
      date: new Date().toISOString().slice(0, 10),
      type: "Issue",
      outletId: input.outletId,
      productId: product.id,
      productName: product.name,
      quantity: baseQuantity,
      status: "Approved",
      reason: "Retail sale",
      requestedBy: actor.name,
      approvedBy: "System",
    });

    return {
      productId: product.id,
      productName: product.name,
      batchNumbers: picks.map((pick) => pick.batch.batchNumber),
      quantity: baseQuantity,
      unitPrice: round2(packPrice / level.unitsPerPackage),
      discount: lineDiscount,
      total: round2(gross - lineDiscount),
      packagingName: level.name,
      unitsPerPackage: level.unitsPerPackage,
      packQuantity: quantity,
      packPrice,
      allocations: picks.map((pick) => ({ batchId: pick.batch.id, batchNumber: pick.batch.batchNumber, quantity: pick.quantity })),
    };
  });

  const walkIn = input.walkIn && (input.walkIn.name?.trim() || input.walkIn.phone?.trim()) ? { name: input.walkIn.name?.trim() || undefined, phone: input.walkIn.phone?.trim() || undefined } : undefined;
  const sale: SaleInvoice = {
    id: newId("sale", `${Date.now()}${nextNumber("saleId")}`),
    number,
    date: options.at ?? new Date().toISOString(),
    outletId: input.outletId,
    customerId: customer.id,
    customerName: customer.type === "Walk-in" && walkIn?.name ? `${walkIn.name} (walk-in)` : customer.name,
    cashier: actor.name,
    cashierId: actor.id,
    lines,
    subtotal,
    discount,
    vat,
    total,
    amountPaid,
    paymentMethod,
    status: amountPaid >= total - 0.001 ? "Paid" : amountPaid > 0 ? "Partially paid" : "Unpaid",
    prescriptionRef: input.prescriptionRef?.trim() || undefined,
    payments: tenders,
    tendered,
    change,
    globalDiscount: input.globalDiscount && globalAmount > 0 ? { ...input.globalDiscount, amount: globalAmount } : undefined,
    discountAuthorisedBy: discount > 0 ? actor.name : undefined,
    walkIn,
    customerKind: input.customerKind,
    heldId: input.heldId,
    receiptPrints: 0,
    offline: options.offline,
  };

  store.sales.unshift(sale);
  customer.balance = round2(customer.balance + outstanding);

  const account = (method: string) => (method === "Cash" ? "Cash till" : method === "Card" ? "POS settlement ••0912" : "GTBank ••2231");
  const receipts = tenders ?? (amountPaid > 0 ? [{ method: (paymentMethod === "Credit" || paymentMethod === "HMO" ? "Transfer" : paymentMethod) as TenderMethod, amount: amountPaid }] : []);
  for (const tender of receipts) {
    store.payments.unshift({
      id: newId("pay", `${Date.now()}-${nextNumber("payment")}`),
      reference: `RCT-${String(nextNumber("payment")).padStart(5, "0")}`,
      date: sale.date,
      direction: "IN",
      partyType: "Customer",
      partyId: customer.id,
      partyName: sale.customerName,
      documentRef: number,
      method: tender.method,
      account: account(tender.method),
      amount: tender.amount,
      recordedBy: actor.name,
    });
  }

  if (input.heldId) {
    const index = store.heldSales.findIndex((row) => row.id === input.heldId && row.outletId === input.outletId);
    if (index >= 0) store.heldSales.splice(index, 1);
  }

  const controlled = prepared.filter(({ product }) => product.controlled);
  recordAudit(actor, {
    action: "sale.create",
    entity: "SaleInvoice",
    entityId: sale.id,
    summary: `${number} · ₦${total.toLocaleString()} · ${sale.customerName} (${tenders ? tenders.map((row) => `${row.method} ₦${row.amount.toLocaleString()}`).join(" + ") : paymentMethod})${change ? ` · change ₦${change.toLocaleString()}` : ""}`,
    outletId: input.outletId,
  });
  if (discount > 0) {
    recordAudit(actor, {
      action: "sale.discount",
      entity: "SaleInvoice",
      entityId: sale.id,
      summary: `${number}: discount ₦${discount.toLocaleString()} (${discountPct.toFixed(1)}% of ₦${subtotal.toLocaleString()}) authorised by ${actor.name}${sale.globalDiscount ? ` · basket ${sale.globalDiscount.type === "percent" ? `${sale.globalDiscount.value}%` : `₦${sale.globalDiscount.value.toLocaleString()}`}` : ""}`,
      outletId: input.outletId,
      severity: discountPct > cashierMaxDiscountPct ? "warning" : "info",
    });
  }
  if (controlled.length) {
    recordAudit(actor, {
      action: "compliance.controlled-sale",
      entity: "SaleInvoice",
      entityId: sale.id,
      summary: `Controlled drug dispensed on ${number}: ${controlled.map(({ product, quantity }) => `${quantity} × ${product.name}`).join(", ")} (Rx ${sale.prescriptionRef})`,
      outletId: input.outletId,
      severity: "warning",
    });
  }

  return sale;
}

/**
 * How a sale was settled, as amounts per method. Split sales list their tenders; older sales put the whole total
 * on their single method. Anything not yet paid on credit/HMO/account sales is reported as "Account".
 */
export function saleTenders(sale: SaleInvoice): { method: "Cash" | "Card" | "Transfer" | "Credit" | "HMO" | "Account"; amount: number }[] {
  if (sale.payments?.length) {
    const rows: { method: "Cash" | "Card" | "Transfer" | "Account"; amount: number }[] = sale.payments.map((row) => ({ method: row.method, amount: row.amount }));
    const owed = round2(sale.total - sale.payments.reduce((sum, row) => sum + row.amount, 0));
    if (owed > 0) rows.push({ method: "Account", amount: owed });
    return rows;
  }
  const method = sale.paymentMethod === "Split" ? "Cash" : sale.paymentMethod;
  return [{ method, amount: sale.total }];
}

/** Sales the actor may see: their outlet(s), and only their own unless they supervise cashiers. */
export function visibleSales(actor: Actor) {
  const rows = scopeByOutlet(actor, getStore().sales, (sale) => sale.outletId);
  if (can(actor, "sales.supervise")) return rows;
  return rows.filter((sale) => sale.cashierId === actor.id || (!sale.cashierId && sale.cashier === actor.name));
}

export function voidSale(actor: Actor, saleId: string, reason: string) {
  assertCan(actor, "sales.void");
  const store = getStore();
  const sale = store.sales.find((row) => row.id === saleId);
  if (!sale) throw new DomainError("Sale not found.", 404);
  assertOutletAccess(actor, sale.outletId);
  if (sale.status === "Voided") throw new DomainError("Sale is already voided.");
  if (!reason.trim()) throw new DomainError("A void reason is required.");
  if (Date.now() - new Date(sale.date).getTime() > 7 * DAY) {
    throw new DomainError("Sales older than 7 days must be reversed with a credit note, not voided.");
  }

  for (const line of sale.lines) {
    const product = products.find((row) => row.id === line.productId);
    if (!product) continue;
    // Units go back to the exact batches they were drawn from (older sales: the first batch listed).
    const allocations = line.allocations?.length
      ? line.allocations
      : [{ batchId: batches.find((row) => row.productId === product.id && row.batchNumber === line.batchNumbers[0])?.id ?? "", batchNumber: line.batchNumbers[0], quantity: line.quantity }];
    for (const allocation of allocations) {
      const batch = batches.find((row) => row.id === allocation.batchId);
      if (!batch || allocation.quantity <= 0) continue;
      postStock(actor, { type: "SALE_VOID", product, batch, baseQuantity: allocation.quantity, reference: `VOID-${sale.number}`, remarks: `Void: ${reason}` });
    }

    stockMovements.unshift({
      id: newId("mov", `${nextNumber("movement")}`),
      reference: `VOID-${sale.number}`,
      date: new Date().toISOString().slice(0, 10),
      type: "Return",
      outletId: sale.outletId,
      productId: product.id,
      productName: line.productName,
      quantity: line.quantity,
      status: "Approved",
      reason: `Void: ${reason}`,
      requestedBy: actor.name,
      approvedBy: actor.name,
    });
  }

  const customer = store.customers.find((row) => row.id === sale.customerId);
  if (customer) customer.balance = Math.max(0, customer.balance - (sale.total - sale.amountPaid));

  if (sale.amountPaid > 0) {
    store.payments.unshift({
      id: newId("pay", `${Date.now()}`),
      reference: `RFD-${String(nextNumber("payment")).padStart(5, "0")}`,
      date: new Date().toISOString(),
      direction: "OUT",
      partyType: "Customer",
      partyId: sale.customerId ?? "",
      partyName: sale.customerName,
      documentRef: sale.number,
      method: "Cash",
      account: "Cash till",
      amount: sale.amountPaid,
      recordedBy: actor.name,
    });
  }

  sale.status = "Voided";
  sale.voidReason = reason;
  sale.amountPaid = 0;

  recordAudit(actor, {
    action: "sale.void",
    entity: "SaleInvoice",
    entityId: sale.id,
    summary: `Voided ${sale.number} (₦${sale.total.toLocaleString()}) — ${reason}`,
    outletId: sale.outletId,
    severity: "warning",
  });
  return sale;
}

// ---------------------------------------------------------------- purchase orders

export type PurchaseOrderInput = {
  supplierId: string;
  outletId: string;
  expectedDate: string;
  notes?: string;
  submit: boolean;
  lines: { productId: string; quantity: number; unitCost: number }[];
};

export function createPurchaseOrder(actor: Actor, input: PurchaseOrderInput) {
  assertCan(actor, "purchase.create");
  assertOutletAccess(actor, input.outletId);
  const store = getStore();

  const supplier = store.suppliers.find((row) => row.id === input.supplierId);
  if (!supplier) throw new DomainError("Unknown supplier.");
  if (supplier.status !== "Approved") {
    throw new DomainError(`${supplier.name} is "${supplier.status}". Only approved suppliers can receive POs.`);
  }
  if (!outlets.some((row) => row.id === input.outletId)) throw new DomainError("Unknown delivery location.");
  if (input.lines.length === 0) throw new DomainError("Add at least one line to the purchase order.");

  const lines = input.lines.map((line) => {
    const product = products.find((row) => row.id === line.productId);
    if (!product) throw new DomainError("Unknown item on purchase order.");
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new DomainError(`Invalid quantity for ${product.name}.`);
    if (line.unitCost <= 0) throw new DomainError(`Unit cost for ${product.name} must be greater than zero.`);
    return { productId: product.id, productName: product.name, quantity: line.quantity, unitCost: line.unitCost, receivedQuantity: 0 };
  });

  const order: PurchaseOrder = {
    id: newId("po", `${Date.now()}`),
    number: `PO-2026-${String(nextNumber("po")).padStart(4, "0")}`,
    supplierId: supplier.id,
    supplierName: supplier.name,
    outletId: input.outletId,
    createdAt: new Date().toISOString(),
    expectedDate: input.expectedDate,
    createdBy: actor.name,
    createdById: actor.id,
    status: input.submit ? "Pending approval" : "Draft",
    lines,
    total: lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    amountPaid: 0,
    notes: input.notes?.trim() || undefined,
  };

  store.purchaseOrders.unshift(order);
  recordAudit(actor, {
    action: "purchase.create",
    entity: "PurchaseOrder",
    entityId: order.id,
    summary: `${order.number} raised for ${supplier.name} · ₦${order.total.toLocaleString()} (${order.status})`,
    outletId: order.outletId,
  });
  return order;
}

export type ReceiptLine = {
  productId: string;
  quantity: number;
  batchNumber: string;
  expiryDate: string;
  manufacturingDate?: string;
  supplierBatchRef?: string;
  regulatoryNumber?: string;
};

/** Opens an item record at another outlet with the same master data and zero stock. */
export function cloneProductForOutlet(template: Product, outletId: string) {
  const copy: Product = {
    ...structuredClone(template),
    id: newId("prod", `${Date.now().toString(36)}-${outletId}`),
    stock: 0,
    status: template.status === "RESTRICTED" ? "RESTRICTED" : "LOW_STOCK",
    outletId,
  };
  products.push(copy);
  return copy;
}

export function transitionPurchaseOrder(
  actor: Actor,
  orderId: string,
  action: "submit" | "approve" | "cancel" | "receive",
  receipt: ReceiptLine[] = [],
  invoiceNumber?: string,
) {
  const store = getStore();
  const order = store.purchaseOrders.find((row) => row.id === orderId);
  if (!order) throw new DomainError("Purchase order not found.", 404);
  assertOutletAccess(actor, order.outletId);

  switch (action) {
    case "submit": {
      assertCan(actor, "purchase.create");
      if (order.status !== "Draft") throw new DomainError("Only draft POs can be submitted.");
      order.status = "Pending approval";
      break;
    }
    case "approve": {
      assertCan(actor, "purchase.approve");
      if (order.status !== "Pending approval") throw new DomainError("Only POs pending approval can be approved.");
      if (order.createdById === actor.id && actor.role !== "SUPER_ADMIN") {
        throw new DomainError("Segregation of duties: you cannot approve a PO you raised.", 403);
      }
      order.status = "Approved";
      order.approvedBy = actor.name;
      break;
    }
    case "cancel": {
      if (order.status === "Draft" || order.status === "Pending approval") {
        if (!can(actor, "purchase.approve") && order.createdById !== actor.id) {
          throw new DomainError("Only the requester or an approver can cancel this PO.", 403);
        }
      } else if (order.status === "Approved") {
        assertCan(actor, "purchase.approve");
      } else {
        throw new DomainError(`A ${order.status.toLowerCase()} PO cannot be cancelled.`);
      }
      order.status = "Cancelled";
      break;
    }
    case "receive": {
      assertCan(actor, "purchase.receive");
      if (order.status !== "Approved" && order.status !== "Partially received") {
        throw new DomainError("Goods can only be received against an approved PO.");
      }
      receiveGoods(actor, order, receipt, invoiceNumber);
      break;
    }
  }

  if (action !== "receive") {
    recordAudit(actor, {
      action: `purchase.${action}`,
      entity: "PurchaseOrder",
      entityId: order.id,
      summary: `${order.number} → ${order.status}`,
      outletId: order.outletId,
      severity: action === "cancel" ? "warning" : "info",
    });
  }
  return order;
}

function receiveGoods(actor: Actor, order: PurchaseOrder, receipt: ReceiptLine[], invoiceNumber?: string) {
  const lines = receipt.filter((line) => line.quantity > 0);
  if (lines.length === 0) throw new DomainError("Enter a received quantity for at least one line.");

  const { minShelfLifeDays } = getStore().settings;
  const minimumExpiry = Date.now() + minShelfLifeDays * DAY;
  for (const line of lines) {
    const poLine = order.lines.find((row) => row.productId === line.productId);
    if (!poLine) throw new DomainError("Received item is not on this PO.");
    const outstanding = poLine.quantity - poLine.receivedQuantity;
    if (!Number.isInteger(line.quantity) || line.quantity > outstanding) {
      throw new DomainError(`${poLine.productName}: cannot receive more than the ${outstanding} outstanding unit(s).`);
    }
    if (!line.batchNumber.trim()) throw new DomainError(`${poLine.productName}: batch number is required.`);
    if (!line.expiryDate || Number.isNaN(Date.parse(line.expiryDate))) throw new DomainError(`${poLine.productName}: expiry date is required.`);
    if (new Date(line.expiryDate).getTime() < minimumExpiry) {
      throw new DomainError(`${poLine.productName}: short-dated stock (under ${minShelfLifeDays} days to expiry) must be rejected at receipt.`);
    }
  }

  const supplier = getStore().suppliers.find((row) => row.id === order.supplierId);
  const today = new Date().toISOString().slice(0, 10);
  let receivedValue = 0;
  const grn = `GRN-${String(nextNumber("movement")).padStart(5, "0")}`;

  for (const line of lines) {
    const poLine = order.lines.find((row) => row.productId === line.productId)!;
    const template = products.find((row) => row.id === line.productId)!;
    let product = products.find((row) => row.name === template.name && row.outletId === order.outletId);
    if (!product) {
      // First receipt of this item at the location: open a location-level item record.
      product = cloneProductForOutlet(template, order.outletId);
    }
    if (product.lifecycle === "DISCONTINUED") throw new DomainError(`${product.name} is discontinued and cannot be received.`);

    poLine.receivedQuantity += line.quantity;
    receivedValue += line.quantity * poLine.unitCost;

    receiveIntoNewBatch(
      actor,
      product,
      {
        batchNumber: line.batchNumber.trim().toUpperCase(),
        manufacturingDate: line.manufacturingDate || today,
        expiryDate: line.expiryDate,
        receivingDate: today,
        supplier: order.supplierName,
        supplierId: order.supplierId,
        supplierBatchRef: line.supplierBatchRef?.trim(),
        regulatoryNumber: line.regulatoryNumber?.trim().toUpperCase(),
        unitCost: poLine.unitCost,
      },
      { type: "RECEIVE", baseQuantity: line.quantity, reference: grn, remarks: `Receipt against ${order.number}` },
    );

    stockMovements.unshift({
      id: newId("mov", `${nextNumber("movement")}`),
      reference: grn,
      date: today,
      type: "Receive",
      outletId: order.outletId,
      productId: product.id,
      productName: product.name,
      quantity: line.quantity,
      status: "Approved",
      invoiceNumber: invoiceNumber?.trim() || undefined,
      purchaseReference: order.number,
      reason: `Receipt against ${order.number}`,
      requestedBy: actor.name,
      approvedBy: actor.name,
    });
  }

  if (supplier) supplier.balance += receivedValue;
  const complete = order.lines.every((line) => line.receivedQuantity >= line.quantity);
  order.status = complete ? "Received" : "Partially received";

  recordAudit(actor, {
    action: "purchase.receive",
    entity: "PurchaseOrder",
    entityId: order.id,
    summary: `${grn} posted against ${order.number}: ${lines.map((line) => `${line.quantity} × ${order.lines.find((row) => row.productId === line.productId)?.productName}`).join(", ")} (₦${receivedValue.toLocaleString()})`,
    outletId: order.outletId,
  });
}

// ---------------------------------------------------------------- contacts

export function createCustomer(
  actor: Actor,
  input: { name: string; type: CustomerType; phone: string; email: string; creditLimit: number; outletId: string | null },
) {
  assertCan(actor, "contacts.manage");
  const store = getStore();
  if (input.name.trim().length < 2) throw new DomainError("Customer name is required.");
  if (store.customers.some((row) => row.name.toLowerCase() === input.name.trim().toLowerCase())) {
    throw new DomainError("A customer with this name already exists.");
  }
  const outletId = isOutletScoped(actor.role) ? actor.outletId : input.outletId;
  const number = nextNumber("customer");
  const customer: Customer = {
    id: newId("cus", `${Date.now()}`),
    code: `CUS-${String(number).padStart(4, "0")}`,
    name: input.name.trim(),
    type: input.type,
    phone: input.phone.trim() || "-",
    email: input.email.trim() || "-",
    outletId,
    creditLimit: input.type === "Walk-in" ? 0 : Math.max(0, input.creditLimit),
    balance: 0,
    status: "Active",
    createdAt: new Date().toISOString(),
  };
  store.customers.push(customer);
  recordAudit(actor, { action: "contacts.create", entity: "Customer", entityId: customer.id, summary: `Created customer ${customer.code} ${customer.name} (${customer.type})`, outletId });
  return customer;
}

export function createSupplier(
  actor: Actor,
  input: { name: string; contactPerson: string; phone: string; email: string; pcnLicense: string; paymentTermsDays: number; categories: string },
) {
  assertCan(actor, "contacts.manage");
  if (!can(actor, "purchase.create") && !can(actor, "purchase.approve")) throw new DomainError("Suppliers are added by purchasing staff.", 403);
  const store = getStore();
  if (input.name.trim().length < 2) throw new DomainError("Supplier name is required.");
  const number = nextNumber("supplier");
  const licensed = /^PCN\//i.test(input.pcnLicense.trim());
  const supplier: Supplier = {
    id: newId("sup", `${Date.now()}`),
    code: `SUP-${String(number).padStart(4, "0")}`,
    name: input.name.trim(),
    contactPerson: input.contactPerson.trim() || "-",
    phone: input.phone.trim() || "-",
    email: input.email.trim() || "-",
    pcnLicense: input.pcnLicense.trim() || "Pending",
    paymentTermsDays: Math.max(0, input.paymentTermsDays),
    balance: 0,
    // New suppliers stay unverified until a regulator or manager confirms the PCN licence.
    status: "Pending verification",
    categories: input.categories.trim() || "General",
  };
  store.suppliers.push(supplier);
  recordAudit(actor, {
    action: "contacts.create",
    entity: "Supplier",
    entityId: supplier.id,
    summary: `Onboarded supplier ${supplier.code} ${supplier.name}${licensed ? "" : " — PCN licence missing"}`,
    severity: licensed ? "info" : "warning",
  });
  return supplier;
}

export function setSupplierStatus(actor: Actor, supplierId: string, status: Supplier["status"]) {
  if (!can(actor, "purchase.approve") && !can(actor, "audit.view")) {
    throw new DomainError("Only managers or regulatory officers can verify suppliers.", 403);
  }
  const supplier = getStore().suppliers.find((row) => row.id === supplierId);
  if (!supplier) throw new DomainError("Supplier not found.", 404);
  if (status === "Approved" && !/^PCN\//i.test(supplier.pcnLicense)) {
    throw new DomainError("Supplier cannot be approved without a valid PCN wholesale licence number.");
  }
  supplier.status = status;
  recordAudit(actor, {
    action: "contacts.verify",
    entity: "Supplier",
    entityId: supplier.id,
    summary: `${supplier.name} → ${status}`,
    severity: status === "Suspended" ? "warning" : "info",
  });
  return supplier;
}

// ---------------------------------------------------------------- payments & expenses

export type PaymentInput = {
  direction: "IN" | "OUT";
  partyType: "Customer" | "Supplier";
  partyId: string;
  documentRef?: string;
  method: Payment["method"];
  account: string;
  amount: number;
};

export function recordPayment(actor: Actor, input: PaymentInput) {
  assertCan(actor, "finance.create");
  const store = getStore();
  if (!(input.amount > 0)) throw new DomainError("Amount must be greater than zero.");

  let partyName = "";
  let documentRef = input.documentRef ?? "On account";

  if (input.partyType === "Customer") {
    const customer = store.customers.find((row) => row.id === input.partyId);
    if (!customer) throw new DomainError("Unknown customer.");
    if (input.amount > customer.balance) {
      throw new DomainError(`Receipt exceeds ${customer.name}'s outstanding balance of ₦${customer.balance.toLocaleString()}.`);
    }
    customer.balance -= input.amount;
    partyName = customer.name;

    // Allocate the receipt to the oldest open invoices.
    let remaining = input.amount;
    const open = store.sales
      .filter((sale) => sale.customerId === customer.id && sale.status !== "Voided" && sale.amountPaid < sale.total)
      .sort((a, b) => a.date.localeCompare(b.date));
    const settled: string[] = [];
    for (const sale of open) {
      if (remaining <= 0) break;
      const apply = Math.min(remaining, sale.total - sale.amountPaid);
      sale.amountPaid += apply;
      sale.status = sale.amountPaid >= sale.total ? "Paid" : "Partially paid";
      remaining -= apply;
      settled.push(sale.number);
    }
    if (settled.length) documentRef = settled.slice(0, 3).join(", ") + (settled.length > 3 ? ` +${settled.length - 3}` : "");
  } else {
    const supplier = store.suppliers.find((row) => row.id === input.partyId);
    if (!supplier) throw new DomainError("Unknown supplier.");
    if (input.amount > supplier.balance) {
      throw new DomainError(`Payment exceeds the ₦${supplier.balance.toLocaleString()} owed to ${supplier.name}.`);
    }
    if (input.amount >= store.settings.supplierPaymentApprovalThreshold) assertCan(actor, "finance.approve");
    supplier.balance -= input.amount;
    partyName = supplier.name;

    let remaining = input.amount;
    const open = store.purchaseOrders
      .filter((order) => order.supplierId === supplier.id && order.status !== "Cancelled")
      .map((order) => ({ order, due: order.lines.reduce((sum, line) => sum + line.receivedQuantity * line.unitCost, 0) - order.amountPaid }))
      .filter((row) => row.due > 0)
      .sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt));
    const settled: string[] = [];
    for (const { order, due } of open) {
      if (remaining <= 0) break;
      const apply = Math.min(remaining, due);
      order.amountPaid += apply;
      remaining -= apply;
      settled.push(order.number);
    }
    if (settled.length) documentRef = settled.join(", ");
  }

  const payment: Payment = {
    id: newId("pay", `${Date.now()}`),
    reference: `${input.direction === "IN" ? "RCT" : "PV"}-${String(nextNumber("payment")).padStart(5, "0")}`,
    date: new Date().toISOString(),
    direction: input.partyType === "Customer" ? "IN" : "OUT",
    partyType: input.partyType,
    partyId: input.partyId,
    partyName,
    documentRef,
    method: input.method,
    account: input.account,
    amount: input.amount,
    recordedBy: actor.name,
  };
  store.payments.unshift(payment);
  recordAudit(actor, {
    action: "finance.payment",
    entity: "Payment",
    entityId: payment.id,
    summary: `${payment.reference}: ₦${payment.amount.toLocaleString()} ${payment.direction === "IN" ? "received from" : "paid to"} ${partyName} via ${payment.account}`,
  });
  return payment;
}

export function createExpense(
  actor: Actor,
  input: { category: string; description: string; vendor: string; outletId: string; amount: number; date: string },
) {
  assertCan(actor, "finance.create");
  assertOutletAccess(actor, input.outletId);
  if (!(input.amount > 0)) throw new DomainError("Amount must be greater than zero.");
  if (input.description.trim().length < 3) throw new DomainError("Describe the expense.");
  const expense: Expense = {
    id: newId("exp", `${Date.now()}`),
    reference: `EXP-${String(nextNumber("expense")).padStart(5, "0")}`,
    date: input.date || new Date().toISOString().slice(0, 10),
    category: input.category,
    description: input.description.trim(),
    vendor: input.vendor.trim() || "-",
    outletId: input.outletId,
    amount: input.amount,
    status: "Submitted",
    requestedBy: actor.name,
    requestedById: actor.id,
  };
  getStore().expenses.unshift(expense);
  recordAudit(actor, { action: "finance.expense", entity: "Expense", entityId: expense.id, summary: `${expense.reference} submitted: ${expense.category} ₦${expense.amount.toLocaleString()}`, outletId: expense.outletId });
  return expense;
}

export function transitionExpense(actor: Actor, expenseId: string, action: "approve" | "reject" | "pay", account?: string) {
  const store = getStore();
  const expense = store.expenses.find((row) => row.id === expenseId);
  if (!expense) throw new DomainError("Expense not found.", 404);

  if (action === "approve" || action === "reject") {
    assertCan(actor, "finance.approve");
    if (expense.status !== "Submitted") throw new DomainError("Only submitted expenses can be reviewed.");
    if (expense.requestedById === actor.id && actor.role !== "SUPER_ADMIN") {
      throw new DomainError("Segregation of duties: you cannot approve your own expense.", 403);
    }
    expense.status = action === "approve" ? "Approved" : "Rejected";
    expense.approvedBy = actor.name;
  } else {
    assertCan(actor, "finance.approve");
    if (expense.status !== "Approved") throw new DomainError("Only approved expenses can be paid.");
    expense.status = "Paid";
    store.payments.unshift({
      id: newId("pay", `${Date.now()}`),
      reference: `PV-${String(nextNumber("payment")).padStart(5, "0")}`,
      date: new Date().toISOString(),
      direction: "OUT",
      partyType: "Expense",
      partyId: expense.id,
      partyName: expense.vendor,
      documentRef: expense.reference,
      method: "Transfer",
      account: account || "GTBank ••2231",
      amount: expense.amount,
      recordedBy: actor.name,
    });
  }

  recordAudit(actor, {
    action: `finance.expense.${action}`,
    entity: "Expense",
    entityId: expense.id,
    summary: `${expense.reference} (${expense.category} ₦${expense.amount.toLocaleString()}) → ${expense.status}`,
    outletId: expense.outletId,
    severity: action === "reject" ? "warning" : "info",
  });
  return expense;
}

// ---------------------------------------------------------------- stock movements

export type StockMovementRequest = {
  type: StockMovement["type"];
  productId: string;
  /** Base units. */
  quantity: number;
  toOutletId?: string;
  reason: string;
  /** Adjustments: IN adds counted stock to a batch, OUT (default) removes it. */
  direction?: "IN" | "OUT";
  /** Batch to adjust or return into (required for IN adjustments). */
  batchId?: string;
};

export function requestStockMovement(actor: Actor, input: StockMovementRequest) {
  assertCan(actor, "stock.request");
  const product = products.find((row) => row.id === input.productId);
  if (!product) throw new DomainError("Unknown item.");
  assertOutletAccess(actor, product.outletId);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new DomainError("Quantity must be a positive whole number.");
  if (!input.reason.trim()) throw new DomainError("A reason is required for every stock movement.");
  if (input.type === "Receive") throw new DomainError("Stock is received through a goods receipt, not a movement request.");
  if (input.type === "Transfer") throw new DomainError("Inter-outlet transfers go through Stock Transfers (request, approval, dispatch and receipt).");
  const direction = input.type === "Adjustment" ? (input.direction ?? "OUT") : undefined;
  if (input.batchId) {
    const batch = batches.find((row) => row.id === input.batchId);
    if (!batch || batch.productId !== product.id) throw new DomainError("Choose a batch of this item.");
  }
  if ((direction === "IN" || input.type === "Return") && !input.batchId && !batches.some((row) => row.productId === product.id && !isBatchBlocked(row))) {
    throw new DomainError("Choose the batch the stock goes back into.");
  }
  if (direction === "IN" && !input.batchId) throw new DomainError("Choose the batch the counted stock belongs to.");
  if (direction === "OUT" && input.quantity > product.stock) {
    throw new DomainError(`Only ${product.stock} unit(s) of ${product.name} on hand.`);
  }
  // Normal issues may only use in-date stock; expired and quarantined batches are blocked.
  if (input.type === "Issue") {
    const sellable = sellableQuantity(product.id, product.outletId);
    if (input.quantity > sellable) {
      throw new DomainError(`Only ${sellable} usable unit(s) of ${product.name} can be issued; expired and quarantined stock is blocked.`);
    }
  }

  const prefix = { Transfer: "TRF", Adjustment: "ADJ", Return: "RTN", Issue: "ISS", Receive: "GRN" }[input.type];
  const movement = addStockMovement({
    id: newId("mov", `${nextNumber("movement")}`),
    reference: `${prefix}-${Date.now().toString().slice(-5)}`,
    type: input.type,
    outletId: product.outletId,
    productId: product.id,
    productName: product.name,
    quantity: input.quantity,
    status: "Pending",
    batchId: input.batchId,
    direction,
    reason: input.reason.trim(),
    requestedBy: actor.name,
  });

  recordAudit(actor, {
    action: "stock.request",
    entity: "StockMovement",
    entityId: movement.id,
    summary: `${movement.reference}: ${input.type}${direction === "IN" ? " (+)" : ""} ${input.quantity} × ${product.name}${input.toOutletId ? ` → ${outletName(input.toOutletId)}` : ""} (${input.reason.trim()})`,
    outletId: product.outletId,
    severity: product.controlled ? "warning" : "info",
  });
  return movement;
}

function movementProduct(movement: StockMovement) {
  return (
    (movement.productId ? products.find((row) => row.id === movement.productId) : undefined) ??
    products.find((row) => row.name === movement.productName && row.outletId === movement.outletId)
  );
}

export function decideStockMovement(actor: Actor, movementId: string, status: "Approved" | "Rejected") {
  assertCan(actor, "stock.approve");
  const movement = stockMovements.find((row) => row.id === movementId);
  if (!movement) throw new DomainError("Movement not found.", 404);
  if (movement.status !== "Pending") throw new DomainError("This movement has already been decided.");
  // Outlet staff decide only their own outlet's movements; changing another outlet's stock needs central scope.
  if (isOutletScoped(actor.role) && actor.outletId !== movement.outletId && actor.outletId !== movement.toOutletId) {
    throw new DomainError("You can only approve movements for your outlet.", 403);
  }
  if (movement.requestedBy && movement.requestedBy === actor.name && actor.role !== "SUPER_ADMIN") {
    throw new DomainError("Maker-checker: a movement must be approved by someone other than the requester.", 403);
  }
  const product = movementProduct(movement);
  const outbound = movement.type === "Transfer" || movement.type === "Issue" || (movement.type === "Adjustment" && movement.direction !== "IN");
  if (status === "Approved" && !product) throw new DomainError("The item on this movement no longer exists at the outlet.");
  if (status === "Approved" && product && outbound && movement.quantity > product.stock) {
    throw new DomainError(`Insufficient stock: ${product.stock} on hand.`);
  }
  if (status === "Approved" && (movement.type === "Transfer" || movement.type === "Issue") && product) {
    const sellable = sellableQuantity(product.id, product.outletId);
    if (movement.quantity > sellable) throw new DomainError(`Only ${sellable} usable unit(s) available.`);
  }

  if (status === "Approved" && product) {
    applyApprovedMovement(actor, movement, product);
  }

  const updated = updateStockMovementStatus(movementId, status, actor.name);

  // Expired-stock handling: completing or reversing a return / disposal.
  if (movement.disposition && movement.batchId) {
    const batch = batches.find((row) => row.id === movement.batchId);
    if (batch) {
      const previous = batch.disposition;
      if (status === "Approved") {
        batch.disposition = { status: movement.disposition === "RETURN" ? "RETURNED" : "DISPOSED", by: actor.name, at: new Date().toISOString(), movementId, supplier: previous?.supplier, note: previous?.note };
        if (movement.disposition === "RETURN") {
          const supplier = getStore().suppliers.find((row) => row.name === (previous?.supplier ?? batch.supplier));
          if (supplier) supplier.balance -= movement.quantity * batch.purchasePrice; // credit note due from supplier
        }
      } else {
        batch.disposition = { status: "QUARANTINED", by: actor.name, at: new Date().toISOString(), note: `${movement.disposition === "RETURN" ? "Return" : "Disposal"} rejected` };
      }
      recordAudit(actor, {
        action: `compliance.${movement.disposition === "RETURN" ? "return" : "disposal"}-${status === "Approved" ? "completed" : "rejected"}`,
        entity: "Batch",
        entityId: batch.id,
        summary: `${batch.productName} batch ${batch.batchNumber}: ${movement.quantity} unit(s) ${status === "Approved" ? (movement.disposition === "RETURN" ? `returned to ${previous?.supplier ?? batch.supplier}` : "disposed") : `${movement.disposition === "RETURN" ? "return" : "disposal"} rejected — back in quarantine`}`,
        outletId: batch.assignedOutletId,
        severity: "warning",
      });
    }
  }
  recordAudit(actor, {
    action: `stock.${status === "Approved" ? "approve" : "reject"}`,
    entity: "StockMovement",
    entityId: movementId,
    summary: `${movement.reference}: ${movement.type} ${movement.quantity} × ${movement.productName} → ${status}`,
    outletId: movement.outletId,
    severity: product?.controlled || movement.type === "Adjustment" ? "warning" : "info",
  });
  return updated;
}

/** Posts the ledger rows for an approved movement. */
function applyApprovedMovement(actor: Actor, movement: StockMovement, product: Product) {
  const posting = { reference: movement.reference, remarks: movement.reason, movementId: movement.id };
  const atSource = batches.filter((batch) => batch.productId === product.id && batch.assignedOutletId === product.outletId);

  if (movement.type === "Return" || (movement.type === "Adjustment" && movement.direction === "IN")) {
    const target =
      atSource.find((batch) => batch.id === movement.batchId) ??
      atSource.filter((batch) => !isBatchBlocked(batch)).sort((a, b) => b.expiryDate.localeCompare(a.expiryDate))[0];
    if (!target) throw new DomainError("There is no batch to return this stock into. Record it as a goods receipt instead.");
    postStock(actor, { ...posting, type: "ADJUSTMENT_IN", product, batch: target, baseQuantity: movement.quantity });
    return;
  }

  if (movement.type === "Transfer") {
    if (!movement.toOutletId) return;
    const destination = products.find((row) => row.name === product.name && row.outletId === movement.toOutletId) ?? cloneProductForOutlet(product, movement.toOutletId);
    const picks = issueFefo(actor, { ...posting, type: "TRANSFER_OUT", product, baseQuantity: movement.quantity });
    for (const pick of picks) {
      // Same batch number and expiry travel with the stock, so traceability is kept at the destination.
      const existing = batches.find((batch) => batch.productId === destination.id && batch.batchNumber === pick.batch.batchNumber && batch.assignedOutletId === movement.toOutletId);
      if (existing) {
        postStock(actor, { ...posting, type: "TRANSFER_IN", product: destination, batch: existing, baseQuantity: pick.quantity });
      } else {
        receiveIntoNewBatch(
          actor,
          destination,
          {
            batchNumber: pick.batch.batchNumber,
            manufacturingDate: pick.batch.manufacturingDate,
            expiryDate: pick.batch.expiryDate,
            supplier: pick.batch.supplier,
            supplierId: pick.batch.supplierId,
            supplierBatchRef: pick.batch.supplierBatchRef,
            regulatoryNumber: pick.batch.regulatoryNumber,
            unitCost: pick.batch.purchasePrice,
          },
          { ...posting, type: "TRANSFER_IN", baseQuantity: pick.quantity, remarks: `${movement.reason ?? "Transfer"} (from ${outletName(movement.outletId)})` },
        );
      }
    }
    return;
  }

  if (movement.type === "Issue") {
    // Normal issuance never draws from expired or quarantined batches.
    issueFefo(actor, { ...posting, type: "ISSUE", product, baseQuantity: movement.quantity });
    return;
  }

  // Adjustment out / write-off: a named batch first (e.g. destruction), then expired batches, then first-expiry-first-out.
  const type = movement.disposition === "DISPOSAL" ? "WRITE_OFF" : movement.disposition === "RETURN" ? "SUPPLIER_RETURN" : "ADJUSTMENT_OUT";
  let remaining = movement.quantity;
  const ordered = [...atSource].sort(
    (a, b) =>
      Number(b.id === movement.batchId) - Number(a.id === movement.batchId) ||
      Number(isExpired(b)) - Number(isExpired(a)) ||
      a.expiryDate.localeCompare(b.expiryDate),
  );
  for (const batch of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(batch.availableQuantity, remaining);
    if (take <= 0) continue;
    postStock(actor, { ...posting, type, product, batch, baseQuantity: take });
    remaining -= take;
  }
  if (remaining > 0) throw new DomainError(`Insufficient stock: ${movement.quantity - remaining} unit(s) on hand.`);
}

// ---------------------------------------------------------------- read models

export function getCompliance() {
  const now = Date.now();
  const expired = batches.filter((batch) => isExpired(batch, now) && batch.availableQuantity > 0);
  const { nearExpiryDays } = getStore().settings;
  const nearExpiry = batches.filter((batch) => !isExpired(batch, now) && daysToExpiry(batch, now) <= nearExpiryDays && batch.availableQuantity > 0);
  const controlledProducts = products.filter((product) => product.controlled);
  const unregistered = products.filter((product) => !product.nafdacNumber || product.nafdacNumber === "Pending");
  const unverifiedSuppliers = getStore().suppliers.filter((supplier) => supplier.status !== "Approved");
  const quarantineValue = expired.reduce((sum, batch) => sum + batch.availableQuantity * batch.purchasePrice, 0);
  return { expired, nearExpiry, controlledProducts, unregistered, unverifiedSuppliers, quarantineValue };
}

export function getSalesKpis(rows: SaleInvoice[]) {
  const active = rows.filter((sale) => sale.status !== "Voided");
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(Date.now() - 30 * DAY).toISOString();
  const month = active.filter((sale) => sale.date >= monthStart);
  const gross = month.reduce((sum, sale) => sum + sale.total, 0);
  return {
    todaySales: active.filter((sale) => sale.date.slice(0, 10) === today).reduce((sum, sale) => sum + sale.total, 0),
    gross,
    count: month.length,
    avgBasket: month.length ? Math.round(gross / month.length) : 0,
    receivable: active.reduce((sum, sale) => sum + (sale.total - sale.amountPaid), 0),
    voided: rows.filter((sale) => sale.status === "Voided").length,
  };
}
