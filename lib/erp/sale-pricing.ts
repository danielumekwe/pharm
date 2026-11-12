// Sale arithmetic shared by the server (createSale) and the offline till, so both always agree.
// Pure module (no app imports): runs in the browser, on the server and under `node --test`.

export type DiscountInput = { type: "percent" | "amount"; value: number };

export class PricingError extends Error {}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A discount as an amount, capped at the base it applies to. */
export function discountAmount(discount: number | DiscountInput | undefined, base: number) {
  if (discount === undefined) return 0;
  if (typeof discount === "number") return Math.max(0, Math.min(discount, base));
  if (!(discount.value >= 0)) throw new PricingError("Discounts cannot be negative.");
  if (discount.type === "percent") {
    if (discount.value > 100) throw new PricingError("A percentage discount cannot exceed 100%.");
    return round2((base * discount.value) / 100);
  }
  return Math.min(round2(discount.value), base);
}

export type PricedLine = { gross: number; discount: number };

/**
 * Totals for a basket. Line discounts first; a basket discount is then shared across lines in proportion
 * to their value (so returns refund the right net amount); VAT is charged on the discounted subtotal.
 */
export function priceBasket(input: { lines: { packPrice: number; quantity: number; discount?: number | DiscountInput }[]; globalDiscount?: DiscountInput; vatRate: number }) {
  const lines: PricedLine[] = input.lines.map((line) => {
    const gross = round2(line.packPrice * line.quantity);
    return { gross, discount: discountAmount(line.discount, gross) };
  });
  const subtotal = round2(lines.reduce((sum, row) => sum + row.gross, 0));
  const afterLines = lines.reduce((sum, row) => sum + row.gross - row.discount, 0);
  const globalAmount = input.globalDiscount ? discountAmount(input.globalDiscount, afterLines) : 0;
  if (globalAmount > 0 && afterLines > 0) {
    let left = globalAmount;
    lines.forEach((row, index) => {
      const share = index === lines.length - 1 ? left : round2((globalAmount * (row.gross - row.discount)) / afterLines);
      row.discount = round2(row.discount + share);
      left = round2(left - share);
    });
  }
  const discount = round2(lines.reduce((sum, row) => sum + row.discount, 0));
  const vat = Math.round((subtotal - discount) * (input.vatRate / 100));
  const total = round2(subtotal - discount + vat);
  return { lines, subtotal, globalAmount, discount, vat, total, discountPct: subtotal > 0 ? (discount / subtotal) * 100 : 0 };
}
