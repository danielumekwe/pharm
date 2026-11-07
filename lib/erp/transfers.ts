// Inter-outlet stock transfers: request → approval → dispatch (stock leaves the source) → receipt at the destination.
// Stock moves only through the ledger: TRANSFER_OUT at dispatch, TRANSFER_IN for what the destination confirms.

import { batches, outlets, products, type Product } from "@/lib/data";
import { issueFefo, postStock, receiveIntoNewBatch } from "@/lib/erp/ledger";
import {
  assertCan,
  assertOutletAccess,
  cloneProductForOutlet,
  DomainError,
  outletName,
  recordAudit,
  sellableQuantity,
} from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor, StockTransfer } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";
import { newId } from "@/lib/erp/ids";
import { assertPlanFeature } from "@/lib/saas/subscriptions";

function find(id: string) {
  const transfer = getStore().transfers.find((row) => row.id === id || row.reference === id);
  if (!transfer) throw new DomainError("Transfer not found.", 404);
  return transfer;
}

function log(transfer: StockTransfer, actor: Actor, action: string, note?: string) {
  transfer.history.push({ at: new Date().toISOString(), actor: actor.name, action, note: note?.trim() || undefined });
}

function audit(actor: Actor, transfer: StockTransfer, action: string, summary: string, severity: "info" | "warning" = "info") {
  recordAudit(actor, { action: `transfer.${action}`, entity: "StockTransfer", entityId: transfer.id, summary: `${transfer.reference} (${outletName(transfer.fromOutletId)} → ${outletName(transfer.toOutletId)}): ${summary}`, outletId: transfer.fromOutletId, severity });
}

/** Transfers the actor may see: any for central roles, otherwise those leaving or arriving at their outlets. */
export function transfersFor(actor: Actor) {
  const rows = getStore().transfers;
  if (!isOutletScoped(actor.role)) return actor.outletId ? rows.filter((row) => row.fromOutletId === actor.outletId || row.toOutletId === actor.outletId) : rows;
  return rows.filter((row) => actor.outletIds.includes(row.fromOutletId) || actor.outletIds.includes(row.toOutletId));
}

export type TransferInput = { fromOutletId: string; toOutletId: string; lines: { productId: string; quantity: number }[]; notes?: string; submit?: boolean };

export async function createTransfer(actor: Actor, input: TransferInput) {
  await assertPlanFeature("stock_transfers");
  assertCan(actor, "stock.request");
  assertOutletAccess(actor, input.fromOutletId);
  if (input.fromOutletId === input.toOutletId) throw new DomainError("Choose a different destination outlet.");
  if (!outlets.some((row) => row.id === input.fromOutletId) || !outlets.some((row) => row.id === input.toOutletId)) throw new DomainError("Unknown outlet.");
  if (input.lines.length === 0) throw new DomainError("Add at least one item to transfer.");
  const seen = new Set<string>();
  const lines = input.lines.map((line) => {
    const product = products.find((row) => row.id === line.productId);
    if (!product || product.outletId !== input.fromOutletId) throw new DomainError("Every item must be stocked at the source outlet.");
    if (seen.has(product.id)) throw new DomainError(`${product.name} is listed twice.`);
    seen.add(product.id);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new DomainError(`${product.name}: quantity must be a positive whole number.`);
    const usable = sellableQuantity(product.id, product.outletId);
    if (line.quantity > usable) throw new DomainError(`${product.name}: only ${usable} usable unit(s) at ${outletName(product.outletId)}; expired and quarantined stock cannot be transferred.`);
    return { productId: product.id, productName: product.name, requested: line.quantity, dispatched: [], received: [] };
  });
  const transfer: StockTransfer = {
    id: newId("trf", `${Date.now().toString(36)}-${nextNumber("transferId")}`),
    reference: `TRF-${String(nextNumber("transfer")).padStart(5, "0")}`,
    fromOutletId: input.fromOutletId,
    toOutletId: input.toOutletId,
    status: input.submit === false ? "Draft" : "Pending approval",
    lines,
    notes: input.notes?.trim() || undefined,
    createdAt: new Date().toISOString(),
    createdBy: actor.name,
    createdById: actor.id,
    discrepancies: [],
    history: [],
  };
  log(transfer, actor, transfer.status === "Draft" ? "created as draft" : "requested", transfer.notes);
  getStore().transfers.unshift(transfer);
  audit(actor, transfer, "request", `${transfer.status === "Draft" ? "draft" : "requested"} — ${lines.map((line) => `${line.requested} × ${line.productName}`).join(", ")}`);
  return transfer;
}

export type TransferAction =
  | { action: "submit" | "approve" | "cancel" | "dispatch"; note?: string }
  | { action: "reject"; note: string }
  | { action: "receive"; note?: string; final?: boolean; lines: { productId: string; batchNumber: string; quantity: number }[] };

export async function actOnTransfer(actor: Actor, id: string, input: TransferAction) {
  await assertPlanFeature("stock_transfers");
  const transfer = find(id);
  const note = input.note?.trim() ?? "";
  switch (input.action) {
    case "submit": {
      assertCan(actor, "stock.request");
      assertOutletAccess(actor, transfer.fromOutletId);
      if (transfer.status !== "Draft") throw new DomainError("Only a draft can be submitted.");
      transfer.status = "Pending approval";
      log(transfer, actor, "submitted for approval", note);
      audit(actor, transfer, "submit", "submitted for approval");
      break;
    }
    case "approve":
    case "reject": {
      assertCan(actor, "stock.approve");
      if (transfer.status !== "Pending approval") throw new DomainError("Only transfers pending approval can be approved or rejected.");
      if (isOutletScoped(actor.role) && actor.outletId !== transfer.fromOutletId) throw new DomainError("Only the source outlet's manager or head office can approve this transfer.", 403);
      if (transfer.createdById === actor.id && actor.role !== "SUPER_ADMIN") throw new DomainError("Maker-checker: someone other than the requester must approve.", 403);
      if (input.action === "reject") {
        if (note.length < 3) throw new DomainError("Give a reason for rejecting the transfer.");
        transfer.status = "Rejected";
        log(transfer, actor, "rejected", note);
        audit(actor, transfer, "reject", `rejected — ${note}`, "warning");
        break;
      }
      for (const line of transfer.lines) {
        const usable = sellableQuantity(line.productId, transfer.fromOutletId);
        if (line.requested > usable) throw new DomainError(`${line.productName}: only ${usable} usable unit(s) left at the source.`);
      }
      transfer.status = "Approved";
      transfer.approvedBy = actor.name;
      log(transfer, actor, "approved", note);
      audit(actor, transfer, "approve", "approved");
      break;
    }
    case "cancel": {
      if (!["Draft", "Pending approval", "Approved"].includes(transfer.status)) throw new DomainError("Dispatched transfers cannot be cancelled; the destination must receive or report the stock.");
      if (transfer.createdById !== actor.id && !can(actor, "stock.approve")) throw new DomainError("Only the requester or an approver can cancel this transfer.", 403);
      if (isOutletScoped(actor.role)) assertOutletAccess(actor, transfer.fromOutletId);
      transfer.status = "Cancelled";
      log(transfer, actor, "cancelled", note);
      audit(actor, transfer, "cancel", `cancelled${note ? ` — ${note}` : ""}`);
      break;
    }
    case "dispatch": {
      assertCan(actor, "stock.request");
      assertOutletAccess(actor, transfer.fromOutletId);
      if (transfer.status !== "Approved") throw new DomainError("Only approved transfers can be dispatched.");
      for (const line of transfer.lines) {
        const product = products.find((row) => row.id === line.productId);
        if (!product) throw new DomainError(`${line.productName} no longer exists at the source.`);
        // First-expiry-first-out; batch numbers and expiry travel with the stock.
        const picks = issueFefo(actor, { type: "TRANSFER_OUT", product, baseQuantity: line.requested, reference: transfer.reference, remarks: `Dispatched to ${outletName(transfer.toOutletId)} (in transit)` });
        line.dispatched = picks.map((pick) => ({ batchId: pick.batch.id, batchNumber: pick.batch.batchNumber, expiryDate: pick.batch.expiryDate, quantity: pick.quantity }));
      }
      transfer.status = "Dispatched";
      transfer.dispatchedAt = new Date().toISOString();
      transfer.dispatchedBy = actor.name;
      log(transfer, actor, "dispatched", note);
      audit(actor, transfer, "dispatch", `dispatched — ${transfer.lines.map((line) => `${line.requested} × ${line.productName} (${line.dispatched.map((row) => row.batchNumber).join(", ")})`).join("; ")}`);
      break;
    }
    case "receive": {
      receive(actor, transfer, input.lines, note, input.final ?? true);
      break;
    }
  }
  return transfer;
}

function receive(actor: Actor, transfer: StockTransfer, lines: { productId: string; batchNumber: string; quantity: number }[], note: string, final: boolean) {
  if (!can(actor, "stock.request") && !can(actor, "purchase.receive")) throw new DomainError("Your role cannot receive stock.", 403);
  assertOutletAccess(actor, transfer.toOutletId);
  if (transfer.status !== "Dispatched" && transfer.status !== "Partially received") throw new DomainError("Only dispatched transfers can be received.");

  // Validate before posting anything.
  const outstanding = (line: StockTransfer["lines"][number], batchNumber: string) =>
    (line.dispatched.find((row) => row.batchNumber === batchNumber)?.quantity ?? 0) - line.received.filter((row) => row.batchNumber === batchNumber).reduce((sum, row) => sum + row.quantity, 0);
  for (const entry of lines) {
    const line = transfer.lines.find((row) => row.productId === entry.productId);
    if (!line) throw new DomainError("A received item is not on this transfer.");
    if (!Number.isInteger(entry.quantity) || entry.quantity < 0) throw new DomainError("Received quantities must be whole numbers.");
    if (entry.quantity > outstanding(line, entry.batchNumber)) throw new DomainError(`${line.productName} batch ${entry.batchNumber}: only ${outstanding(line, entry.batchNumber)} unit(s) are outstanding.`);
  }

  // Work out the result before posting anything, so a refused receipt changes nothing.
  const arriving = (productId: string, batchNumber: string) => lines.filter((row) => row.productId === productId && row.batchNumber === batchNumber).reduce((sum, row) => sum + row.quantity, 0);
  const willBeShort = transfer.lines.some((line) => line.dispatched.some((sent) => outstanding(line, sent.batchNumber) - arriving(line.productId, sent.batchNumber) > 0));
  if (willBeShort && final && note.length < 3) throw new DomainError("Some dispatched stock was not received. Explain the discrepancy (e.g. damaged in transit, short-shipped).");
  if (!lines.some((row) => row.quantity > 0) && !(willBeShort && final)) throw new DomainError("Enter the quantities received.");

  let receivedNow = 0;
  for (const entry of lines.filter((row) => row.quantity > 0)) {
    const line = transfer.lines.find((row) => row.productId === entry.productId)!;
    const sent = line.dispatched.find((row) => row.batchNumber === entry.batchNumber)!;
    const sourceBatch = batches.find((row) => row.id === sent.batchId);
    const template = products.find((row) => row.id === line.productId);
    if (!template) throw new DomainError(`${line.productName} no longer exists.`);
    const destination: Product = products.find((row) => row.name === template.name && row.outletId === transfer.toOutletId) ?? cloneProductForOutlet(template, transfer.toOutletId);
    const existing = batches.find((row) => row.productId === destination.id && row.batchNumber === entry.batchNumber && row.assignedOutletId === transfer.toOutletId);
    const posting = { type: "TRANSFER_IN" as const, baseQuantity: entry.quantity, reference: transfer.reference, remarks: `Received from ${outletName(transfer.fromOutletId)}` };
    if (existing) postStock(actor, { ...posting, product: destination, batch: existing });
    else
      receiveIntoNewBatch(
        actor,
        destination,
        {
          batchNumber: entry.batchNumber,
          manufacturingDate: sourceBatch?.manufacturingDate ?? "",
          expiryDate: sent.expiryDate,
          supplier: sourceBatch?.supplier ?? `Transfer from ${outletName(transfer.fromOutletId)}`,
          supplierId: sourceBatch?.supplierId,
          supplierBatchRef: sourceBatch?.supplierBatchRef,
          regulatoryNumber: sourceBatch?.regulatoryNumber,
          unitCost: sourceBatch?.purchasePrice ?? template.purchasePrice,
        },
        posting,
      );
    line.received.push({ batchNumber: entry.batchNumber, quantity: entry.quantity });
    receivedNow += entry.quantity;
  }

  const shortages = transfer.lines.flatMap((line) => line.dispatched.map((sent) => ({ line, sent, missing: outstanding(line, sent.batchNumber) }))).filter((row) => row.missing > 0);
  if (shortages.length && final) {
    transfer.discrepancies.push(...shortages.map((row) => ({ productName: row.line.productName, batchNumber: row.sent.batchNumber, missing: row.missing, note })));
    transfer.status = "Received";
  } else {
    transfer.status = shortages.length ? "Partially received" : "Received";
  }
  if (transfer.status === "Received") {
    transfer.receivedAt = new Date().toISOString();
    transfer.receivedBy = actor.name;
  }
  log(transfer, actor, transfer.status === "Received" ? (shortages.length ? "received with discrepancies" : "received in full") : "partially received", note || `${receivedNow} unit(s) confirmed`);
  audit(
    actor,
    transfer,
    "receive",
    `${receivedNow} unit(s) received by ${outletName(transfer.toOutletId)}${shortages.length && final ? ` — DISCREPANCY: ${shortages.map((row) => `${row.missing} × ${row.line.productName} ${row.sent.batchNumber}`).join(", ")} (${note})` : ""}`,
    shortages.length && final ? "warning" : "info",
  );
}
