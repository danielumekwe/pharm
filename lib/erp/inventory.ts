// Item master and goods-receipt operations.

import { addStockMovement, batches, products, stockMovements } from "@/lib/data";
import { receiveIntoNewBatch } from "@/lib/erp/ledger";
import { normaliseNafdac, recordPriceChanges } from "@/lib/erp/products";
import {
  assertCan,
  assertOutletAccess,
  DomainError,
  isExpired,
  outletName,
  productPackaging,
  recordAudit,
  refreshProductStatus,
} from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { isOutletScoped } from "@/lib/rbac";

const DAY = 1000 * 60 * 60 * 24;

function validatePricing(purchasePrice: number, sellingPrice: number) {
  if (!(purchasePrice > 0)) throw new DomainError("Cost price must be greater than zero.");
  if (sellingPrice < purchasePrice) throw new DomainError("Selling price cannot be below cost price.");
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
  if (purchasePrice !== item.purchasePrice || sellingPrice !== item.sellingPrice) assertCan(actor, "products.price");
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
    const before = { prices: { purchasePrice: target.purchasePrice, sellingPrice: target.sellingPrice, wholesalePrice: target.wholesalePrice, minSellingPrice: target.minSellingPrice }, packaging: structuredClone(target.packaging ?? []) };
    target.purchasePrice = purchasePrice;
    target.sellingPrice = sellingPrice;
    target.nafdacNumber = nafdacNumber;
    target.rxOnly = rxOnly;
    target.controlled = controlled;
    if (input.restricted !== undefined) target.status = input.restricted ? "RESTRICTED" : "ACTIVE";
    refreshProductStatus(target);
    recordPriceChanges(actor, target, before);
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
  /** Quantity in the chosen packaging level (base units when none is given). */
  quantity: number;
  packagingId?: string;
  /** Cost per package of that level. */
  unitCost: number;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  supplierBatchRef?: string;
  regulatoryNumber?: string;
  /** Supplier invoice / delivery note number and the buyer's purchase reference. */
  invoiceNumber?: string;
  purchaseReference?: string;
  reason: string;
};

/** Goods received without a PO (emergency or donation). Same batch rules as a PO receipt, and flagged for audit. */
export function receiveDirect(actor: Actor, input: DirectReceiptInput) {
  assertCan(actor, "purchase.receive");
  const item = products.find((product) => product.id === input.productId);
  if (!item) throw new DomainError("Select an item from the item master.");
  assertOutletAccess(actor, item.outletId);
  if (item.status === "RESTRICTED") throw new DomainError(`${item.name} is restricted; it cannot be received.`);
  if (item.lifecycle === "DISCONTINUED") throw new DomainError(`${item.name} is discontinued; it cannot be received.`);

  const supplier = getStore().suppliers.find((row) => row.id === input.supplierId);
  if (!supplier) throw new DomainError("Select a supplier.");
  if (supplier.status !== "Approved") throw new DomainError(`${supplier.name} is not a verified supplier.`);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new DomainError("Quantity must be a positive whole number.");
  if (!(input.unitCost > 0)) throw new DomainError("Unit cost is required.");
  const levels = productPackaging(item);
  const level = input.packagingId ? levels.find((row) => row.id === input.packagingId) : levels.find((row) => row.isBase);
  if (!level) throw new DomainError("Choose the packaging the quantity is counted in.");
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
  const regulatoryNumber = input.regulatoryNumber?.trim() ? normaliseNafdac(input.regulatoryNumber) : undefined;

  const baseQuantity = input.quantity * level.unitsPerPackage;
  const value = input.quantity * input.unitCost;
  const reference = `GRN-D${String(nextNumber("movement")).padStart(5, "0")}`;
  const { batch } = receiveIntoNewBatch(
    actor,
    item,
    {
      batchNumber,
      manufacturingDate: input.manufacturingDate,
      expiryDate: input.expiryDate,
      supplier: supplier.name,
      supplierId: supplier.id,
      supplierBatchRef: input.supplierBatchRef?.trim(),
      regulatoryNumber: regulatoryNumber === "Pending" ? undefined : regulatoryNumber,
      unitCost: Math.round((input.unitCost / level.unitsPerPackage) * 10000) / 10000,
    },
    { type: "RECEIVE", baseQuantity, reference, remarks: `Direct receipt (no PO): ${input.reason.trim()}`, unit: { name: level.name, unitsPerPackage: level.unitsPerPackage } },
  );
  supplier.balance += value;

  const movement = addStockMovement({
    reference,
    type: "Receive",
    outletId: item.outletId,
    productId: item.id,
    productName: item.name,
    quantity: baseQuantity,
    status: "Approved",
    batchId: batch.id,
    invoiceNumber: input.invoiceNumber?.trim() || undefined,
    purchaseReference: input.purchaseReference?.trim() || undefined,
    reason: `Direct receipt (no PO): ${input.reason.trim()}`,
    requestedBy: actor.name,
    approvedBy: actor.name,
  });

  recordAudit(actor, {
    action: "purchase.receive",
    entity: "Batch",
    entityId: batch.id,
    summary: `${reference}${input.invoiceNumber?.trim() ? ` (invoice ${input.invoiceNumber.trim()})` : ""}: ${input.quantity} ${level.name}(s)${level.unitsPerPackage > 1 ? ` (${baseQuantity} ${productPackaging(item).find((row) => row.isBase)?.name ?? "units"})` : ""} × ${item.name} batch ${batchNumber} (exp ${input.expiryDate}) from ${supplier.name} WITHOUT PO — ${input.reason.trim()}`,
    outletId: item.outletId,
    severity: "warning",
  });
  return { batch, movement };
}

/** Holds an in-date batch back from sale (e.g. suspected recall, damage) or releases it again. */
export function setBatchQuarantine(actor: Actor, batchId: string, quarantine: boolean, note: string) {
  assertCan(actor, "alerts.manage");
  const batch = batches.find((row) => row.id === batchId);
  if (!batch) throw new DomainError("Batch not found.", 404);
  assertOutletAccess(actor, batch.assignedOutletId);
  if (note.trim().length < 3) throw new DomainError(quarantine ? "Give the reason for quarantine." : "Record why the batch is safe to release.");
  const current = batch.disposition?.status;
  if (quarantine) {
    if (current) throw new DomainError(`Batch is already ${current.toLowerCase().replace("_", " ")}.`);
    batch.disposition = { status: "QUARANTINED", by: actor.name, at: new Date().toISOString(), note: note.trim() };
  } else {
    if (current !== "QUARANTINED") throw new DomainError("Only a quarantined batch can be released.");
    if (isExpired(batch)) throw new DomainError("Expired batches cannot be released for sale.");
    batch.disposition = undefined;
  }
  recordAudit(actor, {
    action: quarantine ? "compliance.quarantine" : "compliance.release",
    entity: "Batch",
    entityId: batch.id,
    summary: `${quarantine ? "Quarantined" : "Released"} ${batch.availableQuantity} × ${batch.productName} batch ${batch.batchNumber} — ${note.trim()}`,
    outletId: batch.assignedOutletId,
    severity: "warning",
  });
  return batch;
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
    productId: batch.productId,
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
