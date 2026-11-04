// Sales returns and refunds: partial or full returns against a completed (non-voided) invoice.

import { batches, products, stockMovements } from "@/lib/data";
import { assertCan, assertOutletAccess, DomainError, isExpired, outletName, recordAudit, refreshProductStatus } from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor, Payment, SaleReturn } from "@/lib/erp/types";

const RETURN_WINDOW_DAYS = 30;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Quantities already returned per product for a sale. */
export function returnedQuantities(saleId: string) {
  const totals: Record<string, number> = {};
  for (const saleReturn of getStore().saleReturns.filter((row) => row.saleId === saleId)) {
    for (const line of saleReturn.lines) totals[line.productId] = (totals[line.productId] ?? 0) + line.quantity;
  }
  return totals;
}

export type ReturnInput = {
  lines: { productId: string; quantity: number }[];
  reason: string;
  refundMethod: SaleReturn["refundMethod"];
  restock: boolean;
};

export function createSaleReturn(actor: Actor, saleId: string, input: ReturnInput) {
  assertCan(actor, "sales.void");
  const store = getStore();
  const sale = store.sales.find((row) => row.id === saleId);
  if (!sale) throw new DomainError("Sale not found.", 404);
  assertOutletAccess(actor, sale.outletId);
  if (sale.status === "Voided") throw new DomainError("A voided sale cannot be returned.");
  if (Date.now() - Date.parse(sale.date) > RETURN_WINDOW_DAYS * 86_400_000) throw new DomainError(`Returns are only accepted within ${RETURN_WINDOW_DAYS} days of sale.`);
  if (input.reason.trim().length < 3) throw new DomainError("Give a reason for the return.");
  const lines = input.lines.filter((line) => line.quantity > 0);
  if (lines.length === 0) throw new DomainError("Enter a quantity for at least one item.");

  const already = returnedQuantities(sale.id);
  const net = sale.subtotal - sale.discount;
  const vatRatio = net > 0 ? sale.vat / net : 0;

  const returnLines = lines.map((line) => {
    const sold = sale.lines.find((row) => row.productId === line.productId);
    if (!sold) throw new DomainError("An item is not on this invoice.");
    if (!Number.isInteger(line.quantity)) throw new DomainError("Quantities must be whole numbers.");
    const returnable = sold.quantity - (already[line.productId] ?? 0);
    if (line.quantity > returnable) throw new DomainError(`${sold.productName}: only ${returnable} unit(s) can still be returned.`);
    const product = products.find((row) => row.id === line.productId);
    if (input.restock && (product?.rxOnly || product?.controlled)) {
      throw new DomainError(`${sold.productName} is prescription-only/controlled and cannot be returned to saleable stock. Untick "return to stock".`);
    }
    const unitNet = sold.total / sold.quantity; // after line discount, before VAT
    const lineNet = round2(unitNet * line.quantity);
    const lineVat = round2(lineNet * vatRatio);
    return { productId: sold.productId, productName: sold.productName, quantity: line.quantity, unitNet: round2(unitNet), net: lineNet, vat: lineVat, total: round2(lineNet + lineVat), batchNumber: sold.batchNumbers[0] };
  });

  const total = round2(returnLines.reduce((sum, line) => sum + line.total, 0));
  const customer = store.customers.find((row) => row.id === sale.customerId);
  // Credit/HMO invoices: reduce what is still owed first; refund anything already paid.
  const outstanding = Math.max(0, sale.total - sale.amountPaid);
  let credited = Math.min(total, outstanding);
  let refunded = round2(total - credited);
  if (input.refundMethod === "Account credit") {
    if (!customer || customer.type === "Walk-in") throw new DomainError("Account credit needs a named customer account.");
    credited = total;
    refunded = 0;
  }

  const number = `RTN-${String(nextNumber("return")).padStart(5, "0")}`;
  const today = new Date().toISOString();

  for (const line of returnLines) {
    if (!input.restock) continue;
    const product = products.find((row) => row.id === line.productId);
    const batch = batches.find((row) => row.batchNumber === line.batchNumber && row.assignedOutletId === sale.outletId && row.productId === line.productId);
    if (!product || !batch || isExpired(batch)) continue; // expired or unknown batch: not restocked
    batch.availableQuantity += line.quantity;
    product.stock += line.quantity;
    refreshProductStatus(product);
    stockMovements.unshift({
      id: `mov-${nextNumber("movement")}`,
      reference: number,
      date: today.slice(0, 10),
      type: "Return",
      outletId: sale.outletId,
      productName: line.productName,
      quantity: line.quantity,
      status: "Approved",
      batchId: batch.id,
      reason: `Customer return on ${sale.number}: ${input.reason.trim()}`,
      requestedBy: actor.name,
      approvedBy: actor.name,
    });
  }

  if (credited > 0) {
    sale.amountPaid = round2(sale.amountPaid + Math.min(credited, outstanding));
    if (customer) customer.balance = round2(customer.balance - credited);
  }
  sale.status = sale.amountPaid >= sale.total ? "Paid" : sale.amountPaid > 0 ? "Partially paid" : "Unpaid";

  if (refunded > 0) {
    const method = input.refundMethod === "Account credit" ? "Cash" : input.refundMethod;
    store.payments.unshift({
      id: `pay-${Date.now()}`,
      reference: `RFD-${String(nextNumber("payment")).padStart(5, "0")}`,
      date: today,
      direction: "OUT",
      partyType: "Customer",
      partyId: sale.customerId ?? "",
      partyName: sale.customerName,
      documentRef: `${number} / ${sale.number}`,
      method: method as Payment["method"],
      account: method === "Cash" ? "Cash till" : method === "Card" ? "POS settlement ••0912" : "GTBank ••2231",
      amount: refunded,
      recordedBy: actor.name,
    });
  }

  const saleReturn: SaleReturn = {
    id: `ret-${Date.now()}`,
    number,
    saleId: sale.id,
    saleNumber: sale.number,
    outletId: sale.outletId,
    date: today,
    processedBy: actor.name,
    processedById: actor.id,
    cashier: sale.cashier,
    cashierId: sale.cashierId,
    lines: returnLines.map(({ batchNumber: _batch, ...line }) => {
      void _batch;
      return line;
    }),
    net: round2(returnLines.reduce((sum, line) => sum + line.net, 0)),
    vat: round2(returnLines.reduce((sum, line) => sum + line.vat, 0)),
    total,
    refundMethod: input.refundMethod,
    refundedAmount: refunded,
    creditedAmount: credited,
    reason: input.reason.trim(),
    restocked: input.restock,
  };
  store.saleReturns.unshift(saleReturn);

  recordAudit(actor, {
    action: "sale.return",
    entity: "SaleReturn",
    entityId: saleReturn.id,
    summary: `${number} on ${sale.number} @ ${outletName(sale.outletId)}: ${returnLines.map((line) => `${line.quantity} × ${line.productName}`).join(", ")} · ₦${total.toLocaleString()} (refunded ₦${refunded.toLocaleString()}${credited ? `, credited ₦${credited.toLocaleString()}` : ""}) — ${input.reason.trim()}`,
    outletId: sale.outletId,
    severity: "warning",
  });
  return saleReturn;
}
