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
  Supplier,
} from "@/lib/erp/types";

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

export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
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
    id: `aud-${nextNumber("audit")}`,
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

/** Units that can legally be sold: batches at the outlet that have not expired. */
export function sellableQuantity(productId: string, outletId: string) {
  return batches
    .filter((batch) => batch.productId === productId && batch.assignedOutletId === outletId && !isExpired(batch))
    .reduce((sum, batch) => sum + batch.availableQuantity, 0);
}

/** First-expiry-first-out allocation across non-expired batches. */
function allocateFefo(productId: string, outletId: string, quantity: number) {
  const candidates = batches
    .filter(
      (batch) =>
        batch.productId === productId &&
        batch.assignedOutletId === outletId &&
        !isExpired(batch) &&
        batch.availableQuantity > 0,
    )
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  let remaining = quantity;
  const picks: { batch: BatchRecord; quantity: number }[] = [];
  for (const batch of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(batch.availableQuantity, remaining);
    picks.push({ batch, quantity: take });
    remaining -= take;
  }
  return { picks, shortfall: remaining };
}

export function getSellableCatalog(outletId: string) {
  return products
    .filter((product) => product.outletId === outletId && product.status !== "RESTRICTED")
    .map((product) => ({
      id: product.id,
      name: product.name,
      strength: product.strength,
      sellingPrice: product.sellingPrice,
      rxOnly: Boolean(product.rxOnly),
      controlled: Boolean(product.controlled),
      available: sellableQuantity(product.id, outletId),
    }));
}

// ---------------------------------------------------------------- sales

export type SaleInput = {
  outletId: string;
  customerId: string | null;
  paymentMethod: PaymentMethod;
  amountPaid?: number;
  prescriptionRef?: string;
  lines: { productId: string; quantity: number; discount?: number }[];
};

export function createSale(actor: Actor, input: SaleInput) {
  assertCan(actor, "sales.create");
  assertOutletAccess(actor, input.outletId);
  const store = getStore();

  const outlet = outlets.find((row) => row.id === input.outletId);
  if (!outlet) throw new DomainError("Unknown outlet.");
  if (outlet.type === "WAREHOUSE") throw new DomainError("Warehouses cannot make retail sales.");
  if (input.lines.length === 0) throw new DomainError("Add at least one item to the sale.");

  const customer = input.customerId ? store.customers.find((row) => row.id === input.customerId) : store.customers[0];
  if (!customer) throw new DomainError("Unknown customer.");
  if (customer.status === "On hold") throw new DomainError(`${customer.name} is on hold. Clear their account before selling.`);

  // Validate every line before mutating anything.
  const prepared = input.lines.map((line) => {
    const product = products.find((row) => row.id === line.productId && row.outletId === input.outletId);
    if (!product) throw new DomainError("One of the items is not stocked at this outlet.");
    if (product.status === "RESTRICTED") throw new DomainError(`${product.name} is restricted and cannot be sold.`);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new DomainError(`Invalid quantity for ${product.name}.`);
    const available = sellableQuantity(product.id, input.outletId);
    if (line.quantity > available) {
      throw new DomainError(`Only ${available} sellable unit(s) of ${product.name} (expired batches are quarantined).`);
    }
    const discount = Math.max(0, Math.min(line.discount ?? 0, product.sellingPrice * line.quantity));
    return { product, quantity: line.quantity, discount };
  });

  const needsRx = prepared.some(({ product }) => product.rxOnly);
  if (needsRx && !input.prescriptionRef?.trim()) {
    throw new DomainError("This sale contains prescription-only medicines. Enter the prescription reference.");
  }

  const subtotal = prepared.reduce((sum, row) => sum + row.product.sellingPrice * row.quantity, 0);
  const discount = prepared.reduce((sum, row) => sum + row.discount, 0);
  const vat = Math.round((subtotal - discount) * (store.settings.vatRate / 100));
  const total = subtotal - discount + vat;

  const isCreditSale = input.paymentMethod === "Credit" || input.paymentMethod === "HMO";
  const amountPaid = isCreditSale ? Math.max(0, Math.min(input.amountPaid ?? 0, total)) : total;
  const outstanding = total - amountPaid;

  if (outstanding > 0) {
    if (customer.type === "Walk-in") throw new DomainError("Walk-in customers must pay in full.");
    if (customer.balance + outstanding > customer.creditLimit) {
      throw new DomainError(
        `Credit limit exceeded for ${customer.name}: ₦${(customer.balance + outstanding).toLocaleString()} of ₦${customer.creditLimit.toLocaleString()}.`,
      );
    }
  }

  const number = `INV-${String(nextNumber("sale")).padStart(5, "0")}`;
  const lines = prepared.map(({ product, quantity, discount: lineDiscount }) => {
    const { picks } = allocateFefo(product.id, input.outletId, quantity);
    for (const pick of picks) pick.batch.availableQuantity -= pick.quantity;
    product.stock = Math.max(0, product.stock - quantity);
    refreshProductStatus(product);

    stockMovements.unshift({
      id: `mov-${nextNumber("movement")}`,
      reference: number,
      date: new Date().toISOString().slice(0, 10),
      type: "Issue",
      outletId: input.outletId,
      productName: product.name,
      quantity,
      status: "Approved",
      reason: "Retail sale",
      requestedBy: actor.name,
      approvedBy: "System",
    });

    return {
      productId: product.id,
      productName: product.name,
      batchNumbers: picks.map((pick) => pick.batch.batchNumber),
      quantity,
      unitPrice: product.sellingPrice,
      discount: lineDiscount,
      total: product.sellingPrice * quantity - lineDiscount,
    };
  });

  const sale: SaleInvoice = {
    id: `sale-${Date.now()}`,
    number,
    date: new Date().toISOString(),
    outletId: input.outletId,
    customerId: customer.id,
    customerName: customer.name,
    cashier: actor.name,
    cashierId: actor.id,
    lines,
    subtotal,
    discount,
    vat,
    total,
    amountPaid,
    paymentMethod: input.paymentMethod,
    status: amountPaid >= total ? "Paid" : amountPaid > 0 ? "Partially paid" : "Unpaid",
    prescriptionRef: input.prescriptionRef?.trim() || undefined,
  };

  store.sales.unshift(sale);
  customer.balance += outstanding;

  if (amountPaid > 0) {
    store.payments.unshift({
      id: `pay-${Date.now()}`,
      reference: `RCT-${String(nextNumber("payment")).padStart(5, "0")}`,
      date: sale.date,
      direction: "IN",
      partyType: "Customer",
      partyId: customer.id,
      partyName: customer.name,
      documentRef: number,
      method: isCreditSale ? "Transfer" : (input.paymentMethod as Payment["method"]),
      account: input.paymentMethod === "Cash" ? "Cash till" : input.paymentMethod === "Card" ? "POS settlement ••0912" : "GTBank ••2231",
      amount: amountPaid,
      recordedBy: actor.name,
    });
  }

  const controlled = prepared.filter(({ product }) => product.controlled);
  recordAudit(actor, {
    action: "sale.create",
    entity: "SaleInvoice",
    entityId: sale.id,
    summary: `${number} · ₦${total.toLocaleString()} · ${customer.name} (${input.paymentMethod})`,
    outletId: input.outletId,
  });
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
    if (product) {
      product.stock += line.quantity;
      refreshProductStatus(product);
    }
    // Return units to the first batch they were drawn from.
    const batch = batches.find((row) => line.batchNumbers[0] && row.batchNumber === line.batchNumbers[0]);
    if (batch) batch.availableQuantity += line.quantity;

    stockMovements.unshift({
      id: `mov-${nextNumber("movement")}`,
      reference: `VOID-${sale.number}`,
      date: new Date().toISOString().slice(0, 10),
      type: "Return",
      outletId: sale.outletId,
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
      id: `pay-${Date.now()}`,
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
    id: `po-${Date.now()}`,
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

export type ReceiptLine = { productId: string; quantity: number; batchNumber: string; expiryDate: string; manufacturingDate?: string };

export function transitionPurchaseOrder(
  actor: Actor,
  orderId: string,
  action: "submit" | "approve" | "cancel" | "receive",
  receipt: ReceiptLine[] = [],
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
      receiveGoods(actor, order, receipt);
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

function receiveGoods(actor: Actor, order: PurchaseOrder, receipt: ReceiptLine[]) {
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
      product = { ...template, id: `prod-${Date.now()}-${line.productId}`, stock: 0, outletId: order.outletId };
      products.push(product);
    }

    product.stock += line.quantity;
    refreshProductStatus(product);
    poLine.receivedQuantity += line.quantity;
    receivedValue += line.quantity * poLine.unitCost;

    batches.unshift({
      id: `batch-${Date.now()}-${line.productId}`,
      batchNumber: line.batchNumber.trim().toUpperCase(),
      productId: product.id,
      productName: product.name,
      supplier: order.supplierName,
      assignedOutletId: order.outletId,
      receivingDate: today,
      manufacturingDate: line.manufacturingDate || today,
      expiryDate: line.expiryDate,
      quantityReceived: line.quantity,
      availableQuantity: line.quantity,
      purchasePrice: poLine.unitCost,
    });

    stockMovements.unshift({
      id: `mov-${nextNumber("movement")}`,
      reference: grn,
      date: today,
      type: "Receive",
      outletId: order.outletId,
      productName: product.name,
      quantity: line.quantity,
      status: "Approved",
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
    id: `cus-${Date.now()}`,
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
  const store = getStore();
  if (input.name.trim().length < 2) throw new DomainError("Supplier name is required.");
  const number = nextNumber("supplier");
  const licensed = /^PCN\//i.test(input.pcnLicense.trim());
  const supplier: Supplier = {
    id: `sup-${Date.now()}`,
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
    id: `pay-${Date.now()}`,
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
    id: `exp-${Date.now()}`,
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
      id: `pay-${Date.now()}`,
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

export function requestStockMovement(
  actor: Actor,
  input: { type: StockMovement["type"]; productId: string; quantity: number; toOutletId?: string; reason: string },
) {
  assertCan(actor, "stock.request");
  const product = products.find((row) => row.id === input.productId);
  if (!product) throw new DomainError("Unknown item.");
  assertOutletAccess(actor, product.outletId);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new DomainError("Quantity must be a positive whole number.");
  if (!input.reason.trim()) throw new DomainError("A reason is required for every stock movement.");
  if (input.type === "Transfer") {
    if (!input.toOutletId || input.toOutletId === product.outletId) throw new DomainError("Choose a different destination location.");
    if (!outlets.some((row) => row.id === input.toOutletId)) throw new DomainError("Unknown destination.");
  }
  if (input.type === "Adjustment" && input.quantity > product.stock) {
    throw new DomainError(`Only ${product.stock} unit(s) of ${product.name} on hand.`);
  }
  // Normal issues and transfers may only use in-date stock; expired batches are blocked.
  if (input.type === "Transfer" || input.type === "Issue") {
    const sellable = sellableQuantity(product.id, product.outletId);
    if (input.quantity > sellable) {
      throw new DomainError(`Only ${sellable} in-date unit(s) of ${product.name} can be ${input.type === "Issue" ? "issued" : "transferred"}; expired stock is blocked and stays in quarantine.`);
    }
  }

  const prefix = { Transfer: "TRF", Adjustment: "ADJ", Return: "RTN", Issue: "ISS", Receive: "GRN" }[input.type];
  const movement = addStockMovement({
    id: `mov-${nextNumber("movement")}`,
    reference: `${prefix}-${Date.now().toString().slice(-5)}`,
    type: input.type,
    outletId: product.outletId,
    toOutletId: input.type === "Transfer" ? input.toOutletId : undefined,
    productName: product.name,
    quantity: input.quantity,
    status: "Pending",
    reason: input.reason.trim(),
    requestedBy: actor.name,
  });

  recordAudit(actor, {
    action: "stock.request",
    entity: "StockMovement",
    entityId: movement.id,
    summary: `${movement.reference}: ${input.type} ${input.quantity} × ${product.name}${input.toOutletId ? ` → ${outletName(input.toOutletId)}` : ""} (${input.reason.trim()})`,
    outletId: product.outletId,
    severity: product.controlled ? "warning" : "info",
  });
  return movement;
}

export function decideStockMovement(actor: Actor, movementId: string, status: "Approved" | "Rejected") {
  assertCan(actor, "stock.approve");
  const movement = stockMovements.find((row) => row.id === movementId);
  if (!movement) throw new DomainError("Movement not found.", 404);
  if (movement.status !== "Pending") throw new DomainError("This movement has already been decided.");
  if (isOutletScoped(actor.role) && actor.outletId !== movement.outletId && actor.outletId !== movement.toOutletId) {
    throw new DomainError("You can only approve movements for your outlet.", 403);
  }
  if (movement.requestedBy && movement.requestedBy === actor.name && actor.role !== "SUPER_ADMIN") {
    throw new DomainError("Maker-checker: a movement must be approved by someone other than the requester.", 403);
  }
  const product = products.find((row) => row.name === movement.productName && row.outletId === movement.outletId);
  if (status === "Approved" && movement.type !== "Receive" && movement.type !== "Return" && product && movement.quantity > product.stock) {
    throw new DomainError(`Insufficient stock: ${product.stock} on hand.`);
  }
  if (status === "Approved" && (movement.type === "Transfer" || movement.type === "Issue") && product) {
    const sellable = sellableQuantity(product.id, product.outletId);
    if (movement.quantity > sellable) throw new DomainError(`Only ${sellable} in-date unit(s) available to transfer.`);
  }

  if (status === "Approved" && product) {
    applyBatchMovement(movement, product);
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


/** Keeps batch quantities in step with an approved movement (item totals are reconciled in lib/data). */
function applyBatchMovement(movement: StockMovement, product: Product) {
  const atSource = batches.filter((batch) => batch.productId === product.id && batch.assignedOutletId === product.outletId);

  if (movement.type === "Return" || movement.type === "Receive") {
    const target = atSource.filter((batch) => !isExpired(batch)).sort((a, b) => b.expiryDate.localeCompare(a.expiryDate))[0];
    if (target) target.availableQuantity += movement.quantity;
    return;
  }

  if (movement.type === "Transfer") {
    if (!movement.toOutletId) return;
    let destination = products.find((row) => row.name === product.name && row.outletId === movement.toOutletId);
    if (!destination) {
      // First stock of this item at the destination: open a location-level item record (credited by reconciliation).
      destination = { ...product, id: `prod-${Date.now()}-${movement.toOutletId}`, stock: 0, outletId: movement.toOutletId };
      products.push(destination);
    }
    const { picks } = allocateFefo(product.id, product.outletId, movement.quantity);
    for (const pick of picks) {
      pick.batch.availableQuantity -= pick.quantity;
      const existing = batches.find(
        (batch) => batch.productId === destination!.id && batch.batchNumber === pick.batch.batchNumber && batch.assignedOutletId === movement.toOutletId,
      );
      if (existing) {
        existing.availableQuantity += pick.quantity;
      } else {
        batches.unshift({
          ...pick.batch,
          id: `batch-${Date.now()}-${pick.batch.id}`,
          productId: destination.id,
          assignedOutletId: movement.toOutletId,
          receivingDate: new Date().toISOString().slice(0, 10),
          quantityReceived: pick.quantity,
          availableQuantity: pick.quantity,
        });
      }
    }
    return;
  }

  if (movement.type === "Issue") {
    // Normal issuance never draws from expired batches.
    const { picks } = allocateFefo(product.id, product.outletId, movement.quantity);
    for (const pick of picks) pick.batch.availableQuantity -= pick.quantity;
    return;
  }

  // Adjustment (write-off): a named batch first (e.g. destruction), then expired batches, then first-expiry-first-out.
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
    batch.availableQuantity -= take;
    remaining -= take;
  }
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
