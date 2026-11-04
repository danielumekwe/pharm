// Item master and goods-receipt operations.

import { addStockMovement, batches, outlets, products, stockMovements, type Product } from "@/lib/data";
import {
  assertCan,
  assertOutletAccess,
  DomainError,
  isExpired,
  outletName,
  recordAudit,
  refreshProductStatus,
} from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { isOutletScoped } from "@/lib/rbac";

const DAY = 1000 * 60 * 60 * 24;
const NAFDAC_PATTERN = /^[A-Z0-9]{2}-\d{4,6}$/;

export const ITEM_CATEGORIES = [
  "Tablets",
  "Capsules",
  "Syrups",
  "Injections",
  "Creams",
  "Supplements",
  "Medical supplies",
  "Devices",
  "Others",
] as const;

export type ItemInput = {
  name: string;
  genericName: string;
  category: string;
  manufacturer: string;
  strength: string;
  uom: string;
  purchasePrice: number;
  sellingPrice: number;
  minStock: number;
  barcode: string;
  nafdacNumber: string;
  rxOnly: boolean;
  controlled: boolean;
  outletId: string;
};

function validatePricing(purchasePrice: number, sellingPrice: number) {
  if (!(purchasePrice > 0)) throw new DomainError("Cost price must be greater than zero.");
  if (sellingPrice < purchasePrice) throw new DomainError("Selling price cannot be below cost price.");
}

function normaliseNafdac(value: string) {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed || trimmed === "PENDING") return "Pending";
  if (!NAFDAC_PATTERN.test(trimmed)) throw new DomainError("NAFDAC number must look like A4-12345, or be left as Pending.");
  return trimmed;
}

/** New item at a location. Stock always starts at zero and only enters through a goods receipt. */
export function createItem(actor: Actor, input: ItemInput) {
  assertCan(actor, "products.manage");
  assertOutletAccess(actor, input.outletId);
  if (!outlets.some((outlet) => outlet.id === input.outletId)) throw new DomainError("Unknown location.");
  if (input.name.trim().length < 2) throw new DomainError("Item name is required.");
  validatePricing(input.purchasePrice, input.sellingPrice);
  if (input.controlled && !input.rxOnly) throw new DomainError("Controlled drugs must also be prescription-only.");

  const name = input.name.trim();
  if (products.some((product) => product.outletId === input.outletId && product.name.toLowerCase() === name.toLowerCase())) {
    throw new DomainError(`${name} already exists at ${outletName(input.outletId)}.`);
  }
  const barcode = input.barcode.trim();
  const sibling = products.find((product) => product.barcode === barcode);
  if (barcode && sibling && sibling.name.toLowerCase() !== name.toLowerCase()) {
    throw new DomainError(`Barcode ${barcode} is already used by ${sibling.name}.`);
  }

  const nafdacNumber = normaliseNafdac(input.nafdacNumber);
  const item: Product = {
    id: `prod-${Date.now()}`,
    name,
    genericName: input.genericName.trim() || name,
    category: input.category,
    manufacturer: input.manufacturer.trim() || "-",
    strength: input.strength.trim() || "-",
    uom: input.uom.trim() || "Pack",
    purchasePrice: input.purchasePrice,
    sellingPrice: input.sellingPrice,
    minStock: Math.max(0, Math.floor(input.minStock)),
    stock: 0,
    status: "LOW_STOCK",
    barcode: barcode || `890${Date.now().toString().slice(-10)}`,
    nafdacNumber,
    outletId: input.outletId,
    expiryWindow: "-",
    rxOnly: input.rxOnly,
    controlled: input.controlled,
  };
  refreshProductStatus(item);
  products.unshift(item);

  recordAudit(actor, {
    action: "products.create",
    entity: "Product",
    entityId: item.id,
    summary: `Added ${item.name} at ${outletName(item.outletId)} · cost ₦${item.purchasePrice.toLocaleString()} / price ₦${item.sellingPrice.toLocaleString()}${nafdacNumber === "Pending" ? " · NAFDAC no. pending" : ""}`,
    outletId: item.outletId,
    severity: nafdacNumber === "Pending" ? "warning" : "info",
  });
  return item;
}

export type ItemUpdate = {
  purchasePrice?: number;
  sellingPrice?: number;
  minStock?: number;
  nafdacNumber?: string;
  rxOnly?: boolean;
  controlled?: boolean;
  restricted?: boolean;
  /** Apply price and regulatory changes to the same item at every location. */
  allLocations?: boolean;
};

export function updateItem(actor: Actor, itemId: string, input: ItemUpdate) {
  assertCan(actor, "products.manage");
  const item = products.find((product) => product.id === itemId);
  if (!item) throw new DomainError("Item not found.", 404);
  assertOutletAccess(actor, item.outletId);

  const purchasePrice = input.purchasePrice ?? item.purchasePrice;
  const sellingPrice = input.sellingPrice ?? item.sellingPrice;
  validatePricing(purchasePrice, sellingPrice);
  const rxOnly = input.rxOnly ?? Boolean(item.rxOnly);
  const controlled = input.controlled ?? Boolean(item.controlled);
  if (controlled && !rxOnly) throw new DomainError("Controlled drugs must also be prescription-only.");
  const nafdacNumber = input.nafdacNumber !== undefined ? normaliseNafdac(input.nafdacNumber) : item.nafdacNumber;

  // Restricting stock (e.g. a recall) or lifting it is a compliance decision.
  if (input.restricted !== undefined && input.restricted !== (item.status === "RESTRICTED")) {
    if (actor.role !== "SUPER_ADMIN" && actor.role !== "PHARMACY_MANAGER") {
      throw new DomainError("Only a pharmacy manager can restrict or release an item.", 403);
    }
  }

  // Changing the whole network's price needs head-office scope.
  const targets =
    input.allLocations && !isOutletScoped(actor.role) ? products.filter((product) => product.name === item.name) : [item];

  const changes: string[] = [];
  if (purchasePrice !== item.purchasePrice) changes.push(`cost ₦${item.purchasePrice.toLocaleString()} → ₦${purchasePrice.toLocaleString()}`);
  if (sellingPrice !== item.sellingPrice) changes.push(`price ₦${item.sellingPrice.toLocaleString()} → ₦${sellingPrice.toLocaleString()}`);
  if (input.minStock !== undefined && input.minStock !== item.minStock) changes.push(`reorder level ${item.minStock} → ${input.minStock}`);
  if (nafdacNumber !== item.nafdacNumber) changes.push(`NAFDAC ${item.nafdacNumber} → ${nafdacNumber}`);
  if (rxOnly !== Boolean(item.rxOnly)) changes.push(rxOnly ? "now prescription-only" : "now OTC");
  if (controlled !== Boolean(item.controlled)) changes.push(controlled ? "now controlled" : "no longer controlled");
  if (input.restricted !== undefined && input.restricted !== (item.status === "RESTRICTED")) changes.push(input.restricted ? "RESTRICTED" : "released");

  for (const target of targets) {
    target.purchasePrice = purchasePrice;
    target.sellingPrice = sellingPrice;
    target.nafdacNumber = nafdacNumber;
    target.rxOnly = rxOnly;
    target.controlled = controlled;
    if (input.restricted !== undefined) target.status = input.restricted ? "RESTRICTED" : "ACTIVE";
    refreshProductStatus(target);
  }
  // Reorder levels are location-specific.
  if (input.minStock !== undefined) {
    item.minStock = Math.max(0, Math.floor(input.minStock));
    refreshProductStatus(item);
  }

  recordAudit(actor, {
    action: "products.update",
    entity: "Product",
    entityId: item.id,
    summary: `${item.name}${targets.length > 1 ? ` (${targets.length} locations)` : ` @ ${outletName(item.outletId)}`}: ${changes.join(", ") || "no changes"}`,
    outletId: targets.length > 1 ? null : item.outletId,
    severity: changes.some((change) => change.includes("RESTRICTED") || change.startsWith("price") || change.includes("controlled")) ? "warning" : "info",
  });
  return item;
}

export type DirectReceiptInput = {
  productId: string;
  supplierId: string;
  quantity: number;
  unitCost: number;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  reason: string;
};

/** Goods received without a PO (emergency or donation). Same batch rules as a PO receipt, and flagged for audit. */
export function receiveDirect(actor: Actor, input: DirectReceiptInput) {
  assertCan(actor, "purchase.receive");
  const item = products.find((product) => product.id === input.productId);
  if (!item) throw new DomainError("Select an item from the item master.");
  assertOutletAccess(actor, item.outletId);
  if (item.status === "RESTRICTED") throw new DomainError(`${item.name} is restricted; it cannot be received.`);

  const supplier = getStore().suppliers.find((row) => row.id === input.supplierId);
  if (!supplier) throw new DomainError("Select a supplier.");
  if (supplier.status !== "Approved") throw new DomainError(`${supplier.name} is not a verified supplier.`);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new DomainError("Quantity must be a positive whole number.");
  if (!(input.unitCost > 0)) throw new DomainError("Unit cost is required.");
  const batchNumber = input.batchNumber.trim().toUpperCase();
  if (!batchNumber) throw new DomainError("Batch number is required.");
  if (batches.some((batch) => batch.productId === item.id && batch.batchNumber === batchNumber)) {
    throw new DomainError(`Batch ${batchNumber} has already been received for ${item.name}.`);
  }
  const expiry = Date.parse(input.expiryDate);
  const manufactured = Date.parse(input.manufacturingDate);
  if (Number.isNaN(expiry) || Number.isNaN(manufactured)) throw new DomainError("Manufacturing and expiry dates are required.");
  if (manufactured > Date.now()) throw new DomainError("Manufacturing date cannot be in the future.");
  if (expiry <= manufactured) throw new DomainError("Expiry must be after the manufacturing date.");
  const { minShelfLifeDays } = getStore().settings;
  if (expiry < Date.now() + minShelfLifeDays * DAY) throw new DomainError(`Short-dated stock (under ${minShelfLifeDays} days to expiry) must be rejected at receipt.`);
  if (input.reason.trim().length < 3) throw new DomainError("State why this delivery has no purchase order.");

  const today = new Date().toISOString().slice(0, 10);
  const batch = {
    id: `batch-${Date.now()}`,
    batchNumber,
    productId: item.id,
    productName: item.name,
    supplier: supplier.name,
    assignedOutletId: item.outletId,
    receivingDate: today,
    manufacturingDate: input.manufacturingDate,
    expiryDate: input.expiryDate,
    quantityReceived: input.quantity,
    availableQuantity: input.quantity,
    purchasePrice: input.unitCost,
  };
  batches.unshift(batch);
  item.stock += input.quantity;
  refreshProductStatus(item);
  supplier.balance += input.quantity * input.unitCost;

  const movement = addStockMovement({
    reference: `GRN-D${Date.now().toString().slice(-5)}`,
    type: "Receive",
    outletId: item.outletId,
    productName: item.name,
    quantity: input.quantity,
    status: "Approved",
    batchId: batch.id,
    reason: `Direct receipt (no PO): ${input.reason.trim()}`,
    requestedBy: actor.name,
    approvedBy: actor.name,
  });

  recordAudit(actor, {
    action: "purchase.receive",
    entity: "Batch",
    entityId: batch.id,
    summary: `${movement.reference}: ${input.quantity} × ${item.name} batch ${batchNumber} (exp ${input.expiryDate}) from ${supplier.name} WITHOUT PO — ${input.reason.trim()}`,
    outletId: item.outletId,
    severity: "warning",
  });
  return { batch, movement };
}

/** Raises a pending write-off for an expired batch; a second person approves it on the Stock page. */
export function requestBatchDestruction(actor: Actor, batchId: string, note: string) {
  assertCan(actor, "stock.request");
  const batch = batches.find((row) => row.id === batchId);
  if (!batch) throw new DomainError("Batch not found.", 404);
  assertOutletAccess(actor, batch.assignedOutletId);
  if (!isExpired(batch)) throw new DomainError("Only expired batches can be sent for destruction.");
  if (batch.availableQuantity <= 0) throw new DomainError("This batch has no remaining units.");
  if (stockMovements.some((movement) => movement.batchId === batch.id && movement.status === "Pending")) {
    throw new DomainError("A destruction request for this batch is already awaiting approval.");
  }

  const movement = addStockMovement({
    reference: `DST-${Date.now().toString().slice(-5)}`,
    type: "Adjustment",
    outletId: batch.assignedOutletId,
    productName: batch.productName,
    quantity: batch.availableQuantity,
    status: "Pending",
    batchId: batch.id,
    disposition: "DISPOSAL",
    reason: `Expired — destruction of batch ${batch.batchNumber}${note.trim() ? ` (${note.trim()})` : ""}`,
    requestedBy: actor.name,
  });
  batch.disposition = { status: "DISPOSAL_PENDING", by: actor.name, at: new Date().toISOString(), note: note.trim() || undefined, movementId: movement.id, supplier: batch.supplier };

  recordAudit(actor, {
    action: "compliance.destruction-request",
    entity: "Batch",
    entityId: batch.id,
    summary: `Destruction requested: ${batch.availableQuantity} × ${batch.productName} batch ${batch.batchNumber} (expired ${batch.expiryDate})`,
    outletId: batch.assignedOutletId,
    severity: "warning",
  });
  return movement;
}
