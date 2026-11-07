// Stock ledger: the only code that changes stock. Every receipt, sale, return, transfer, adjustment and
// write-off posts an immutable row here; batch.availableQuantity and product.stock are caches of the
// running totals, kept in step by postStock() and checked by verifyLedger().

import { batches, products, type BatchRecord, type Product } from "@/lib/data";
import { DomainError, isBatchBlocked, refreshProductStatus, requestPersist } from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor, StockLedgerEntry, StockLedgerType } from "@/lib/erp/types";
import { newId } from "@/lib/erp/ids";

export const INBOUND_TYPES: readonly StockLedgerType[] = ["OPENING", "RECEIVE", "SALE_RETURN", "SALE_VOID", "TRANSFER_IN", "ADJUSTMENT_IN"];

export const LEDGER_LABELS: Record<StockLedgerType, string> = {
  OPENING: "Opening balance",
  RECEIVE: "Goods received",
  SALE: "Sale",
  SALE_RETURN: "Customer return",
  SALE_VOID: "Sale voided",
  ISSUE: "Internal issue",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  ADJUSTMENT_IN: "Adjustment (+)",
  ADJUSTMENT_OUT: "Adjustment (−)",
  WRITE_OFF: "Write-off / disposal",
  SUPPLIER_RETURN: "Returned to supplier",
};

type Who = Pick<Actor, "id" | "name">;

export type PostInput = {
  type: StockLedgerType;
  product: Product;
  batch: BatchRecord;
  /** Size of the movement in base units (always positive; the type decides the direction). */
  baseQuantity: number;
  reference: string;
  remarks?: string;
  movementId?: string;
  /** Unit the quantity was entered in. Defaults to the base unit. */
  unit?: { name: string; unitsPerPackage: number };
};

export function baseUnitName(product: Pick<Product, "baseUnit" | "uom">) {
  return product.baseUnit || product.uom || "Unit";
}

/** Posts one stock transaction and updates the batch and item balances it affects. */
export function postStock(actor: Who, input: PostInput): StockLedgerEntry {
  const { product, batch, type } = input;
  if (!Number.isInteger(input.baseQuantity) || input.baseQuantity <= 0) throw new DomainError("Stock quantities must be positive whole numbers of the base unit.");
  if (batch.productId !== product.id) throw new DomainError(`Batch ${batch.batchNumber} does not belong to ${product.name}.`);
  if (batch.assignedOutletId !== product.outletId) throw new DomainError(`Batch ${batch.batchNumber} is held at a different outlet.`);

  const delta = INBOUND_TYPES.includes(type) ? input.baseQuantity : -input.baseQuantity;
  if (batch.availableQuantity + delta < 0) {
    throw new DomainError(`Batch ${batch.batchNumber} of ${product.name} has only ${batch.availableQuantity} ${baseUnitName(product)}(s) left.`);
  }

  const previousBalance = product.stock;
  batch.availableQuantity += delta;
  product.stock = previousBalance + delta;
  refreshProductStatus(product);

  const unit = input.unit ?? { name: baseUnitName(product), unitsPerPackage: 1 };
  const entry: StockLedgerEntry = {
    id: newId("led", `${nextNumber("ledger")}`),
    reference: input.reference,
    at: new Date().toISOString(),
    type,
    productId: product.id,
    productName: product.name,
    outletId: product.outletId,
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    quantity: unit.unitsPerPackage > 1 ? input.baseQuantity / unit.unitsPerPackage : input.baseQuantity,
    unit: unit.name,
    unitsPerUnit: unit.unitsPerPackage,
    baseQuantity: delta,
    previousBalance,
    newBalance: product.stock,
    batchBalance: batch.availableQuantity,
    unitCost: batch.purchasePrice,
    userId: actor.id,
    userName: actor.name,
    remarks: input.remarks,
    movementId: input.movementId,
  };
  getStore().stockLedger.unshift(entry);
  requestPersist();
  return entry;
}

export type NewBatchInput = {
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  receivingDate?: string;
  supplier: string;
  supplierId?: string;
  supplierBatchRef?: string;
  regulatoryNumber?: string;
  /** Cost per base unit. */
  unitCost: number;
};

/** Creates a batch (empty) and posts the inbound quantity into it, so even the first stock is a ledger row. */
export function receiveIntoNewBatch(
  actor: Who,
  product: Product,
  batchInput: NewBatchInput,
  posting: Omit<PostInput, "product" | "batch">,
) {
  const batch: BatchRecord = {
    id: newId("batch", `${nextNumber("batch")}-${Date.now().toString(36)}`),
    batchNumber: batchInput.batchNumber,
    productId: product.id,
    productName: product.name,
    supplier: batchInput.supplier,
    supplierId: batchInput.supplierId,
    supplierBatchRef: batchInput.supplierBatchRef || undefined,
    regulatoryNumber: batchInput.regulatoryNumber || undefined,
    assignedOutletId: product.outletId,
    receivingDate: batchInput.receivingDate ?? new Date().toISOString().slice(0, 10),
    manufacturingDate: batchInput.manufacturingDate,
    expiryDate: batchInput.expiryDate,
    quantityReceived: posting.baseQuantity,
    availableQuantity: 0,
    purchasePrice: batchInput.unitCost,
  };
  batches.unshift(batch);
  const entry = postStock(actor, { ...posting, product, batch });
  return { batch, entry };
}

/** First-expiry-first-out picks from usable (in-date, not quarantined) batches. */
export function allocateFefo(productId: string, outletId: string, quantity: number) {
  const candidates = batches
    .filter((batch) => batch.productId === productId && batch.assignedOutletId === outletId && batch.availableQuantity > 0 && !isBatchBlocked(batch))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.receivingDate.localeCompare(b.receivingDate));
  let remaining = quantity;
  const picks: { batch: BatchRecord; quantity: number }[] = [];
  for (const batch of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(batch.availableQuantity, remaining);
    picks.push({ batch, quantity: take });
    remaining -= take;
  }
  return { picks, shortfall: Math.max(0, remaining) };
}

/** Takes stock out FEFO and posts one ledger row per batch drawn. */
export function issueFefo(actor: Who, input: Omit<PostInput, "batch">) {
  const { picks, shortfall } = allocateFefo(input.product.id, input.product.outletId, input.baseQuantity);
  if (shortfall > 0) {
    throw new DomainError(`Only ${input.baseQuantity - shortfall} usable ${baseUnitName(input.product)}(s) of ${input.product.name}; expired and quarantined batches cannot be used.`);
  }
  return picks.map((pick) => ({ batch: pick.batch, quantity: pick.quantity, entry: postStock(actor, { ...input, batch: pick.batch, baseQuantity: pick.quantity }) }));
}

// ---------------------------------------------------------------- read models

export type StockSummary = {
  opening: number;
  received: number;
  sold: number;
  issued: number;
  transferredIn: number;
  transferredOut: number;
  /** Customer returns and voided sales back into stock. */
  returned: number;
  /** Returned to suppliers. */
  supplierReturns: number;
  /** Net count adjustments (+/−). */
  adjustments: number;
  writtenOff: number;
  available: number;
  /** Usable now (excludes expired / quarantined batches). */
  usable: number;
  /** At batch cost. */
  value: number;
};

export function summarise(entries: StockLedgerEntry[], productBatches: BatchRecord[]): StockSummary {
  const total = (types: StockLedgerType[]) => entries.filter((entry) => types.includes(entry.type)).reduce((sum, entry) => sum + Math.abs(entry.baseQuantity), 0);
  const adjustments = entries.filter((entry) => entry.type === "ADJUSTMENT_IN" || entry.type === "ADJUSTMENT_OUT").reduce((sum, entry) => sum + entry.baseQuantity, 0);
  return {
    opening: total(["OPENING"]),
    received: total(["RECEIVE"]),
    sold: total(["SALE"]),
    issued: total(["ISSUE"]),
    transferredIn: total(["TRANSFER_IN"]),
    transferredOut: total(["TRANSFER_OUT"]),
    returned: total(["SALE_RETURN", "SALE_VOID"]),
    supplierReturns: total(["SUPPLIER_RETURN"]),
    adjustments,
    writtenOff: total(["WRITE_OFF"]),
    available: entries.reduce((sum, entry) => sum + entry.baseQuantity, 0),
    usable: productBatches.filter((batch) => !isBatchBlocked(batch)).reduce((sum, batch) => sum + batch.availableQuantity, 0),
    value: productBatches.reduce((sum, batch) => sum + batch.availableQuantity * batch.purchasePrice, 0),
  };
}

export function ledgerFor(filter: { productId?: string; outletId?: string | null; batchId?: string }) {
  return getStore().stockLedger.filter(
    (entry) =>
      (!filter.productId || entry.productId === filter.productId) &&
      (!filter.outletId || entry.outletId === filter.outletId) &&
      (!filter.batchId || entry.batchId === filter.batchId),
  );
}

/** Confirms every cached balance equals the sum of its ledger rows. Returns the mismatches (empty when healthy). */
export function verifyLedger(outletId?: string | null) {
  const byBatch = new Map<string, number>();
  const byProduct = new Map<string, number>();
  for (const entry of getStore().stockLedger) {
    byBatch.set(entry.batchId, (byBatch.get(entry.batchId) ?? 0) + entry.baseQuantity);
    byProduct.set(entry.productId, (byProduct.get(entry.productId) ?? 0) + entry.baseQuantity);
  }
  const mismatches: { kind: "batch" | "product"; id: string; name: string; outletId: string; cached: number; ledger: number }[] = [];
  for (const batch of batches) {
    if (outletId && batch.assignedOutletId !== outletId) continue;
    const ledger = byBatch.get(batch.id) ?? 0;
    if (ledger !== batch.availableQuantity) mismatches.push({ kind: "batch", id: batch.id, name: `${batch.productName} ${batch.batchNumber}`, outletId: batch.assignedOutletId, cached: batch.availableQuantity, ledger });
  }
  for (const product of products) {
    if (outletId && product.outletId !== outletId) continue;
    const ledger = byProduct.get(product.id) ?? 0;
    if (ledger !== product.stock) mismatches.push({ kind: "product", id: product.id, name: product.name, outletId: product.outletId, cached: product.stock, ledger });
  }
  return mismatches;
}
