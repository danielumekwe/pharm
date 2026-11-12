// Sale arithmetic shared by the server and the offline till (pure module).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { discountAmount, priceBasket, PricingError } from "../lib/erp/sale-pricing.ts";

describe("Sale arithmetic", () => {
  test("line discounts, a basket discount shared by value, and VAT on the discounted subtotal", () => {
    const result = priceBasket({
      lines: [
        { packPrice: 500, quantity: 2, discount: { type: "percent", value: 10 } }, // 1000 - 100
        { packPrice: 250, quantity: 1 }, // 250
      ],
      globalDiscount: { type: "amount", value: 115 },
      vatRate: 7.5,
    });
    assert.equal(result.subtotal, 1250);
    assert.deepEqual(result.lines.map((line) => line.discount), [100 + 90, 25], "₦115 shared 900:250");
    assert.equal(result.discount, 215);
    assert.equal(result.vat, Math.round(1035 * 0.075));
    assert.equal(result.total, 1035 + 78);
    assert.equal(Number(result.discountPct.toFixed(2)), 17.2);
  });

  test("discounts are capped and validated", () => {
    assert.equal(discountAmount({ type: "amount", value: 999 }, 100), 100);
    assert.equal(discountAmount(30, 20), 20);
    assert.throws(() => discountAmount({ type: "percent", value: 120 }, 100), PricingError);
    assert.throws(() => discountAmount({ type: "amount", value: -1 }, 100), PricingError);
  });

  test("no VAT and no discount gives the plain total", () => {
    const result = priceBasket({ lines: [{ packPrice: 33.33, quantity: 3 }], vatRate: 0 });
    assert.equal(result.total, 99.99);
    assert.equal(result.discountPct, 0);
  });
});
