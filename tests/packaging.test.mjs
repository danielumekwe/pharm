// Packaging conversions, unit pricing and barcode rules (pure module, no server needed).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  barcodeError,
  breakdown,
  buildPackaging,
  describeBreakdown,
  describeConversion,
  detectBarcodeFormat,
  gs1CheckDigit,
  internalEan13,
  packagePrice,
  toBaseUnits,
} from "../lib/erp/packaging.ts";

const tablets = () =>
  buildPackaging([
    { name: "Carton", contains: 10 },
    { name: "Pack", contains: 10 },
    { name: "Strip", contains: 10 },
    { name: "Tablet", contains: 1 },
  ]);

describe("Packaging conversions", () => {
  test("1 carton = 10 packs = 100 strips = 1,000 tablets", () => {
    const levels = tablets();
    assert.deepEqual(levels.map((level) => level.unitsPerPackage), [1000, 100, 10, 1]);
    assert.equal(levels[3].isBase, true);
    assert.equal(levels.filter((level) => level.isBase).length, 1);
    assert.equal(toBaseUnits(2, levels[0]), 2000);
    assert.equal(toBaseUnits(3, levels[2]), 30);
    assert.equal(describeConversion(levels), "1 Carton = 10 Pack = 100 Strip = 1,000 Tablet");
  });

  test("structures differ per product (bottles, sachets, single level)", () => {
    const syrup = buildPackaging([{ name: "Carton", contains: 24 }, { name: "Bottle", contains: 1 }]);
    assert.deepEqual(syrup.map((level) => level.unitsPerPackage), [24, 1]);
    const sachets = buildPackaging([{ name: "Box", contains: 50 }, { name: "Sachet", contains: 1 }]);
    assert.equal(sachets[0].unitsPerPackage, 50);
    const single = buildPackaging([{ name: "Piece", contains: 99 }]);
    assert.deepEqual(single.map((level) => [level.unitsPerPackage, level.contains]), [[1, 1]], "the base unit always contains 1");
  });

  test("rejects invalid structures", () => {
    assert.throws(() => buildPackaging([]), /base unit/);
    assert.throws(() => buildPackaging([{ name: "Pack", contains: 1 }, { name: "Tablet", contains: 1 }]), /2 or more/);
    assert.throws(() => buildPackaging([{ name: "Pack", contains: 2.5 }, { name: "Tablet", contains: 1 }]), /whole number/);
    assert.throws(() => buildPackaging([{ name: "Pack", contains: 10 }, { name: "pack", contains: 1 }]), /twice/);
    assert.throws(() => buildPackaging([{ name: " ", contains: 10 }, { name: "Tablet", contains: 1 }]), /name/);
  });

  test("breaks base units back into whole packages", () => {
    const levels = tablets();
    assert.deepEqual(breakdown(1234, levels), [
      { name: "Carton", count: 1 },
      { name: "Pack", count: 2 },
      { name: "Strip", count: 3 },
      { name: "Tablet", count: 4 },
    ]);
    assert.equal(describeBreakdown(0, levels), "0 Tablet");
    assert.equal(describeBreakdown(100, levels), "1 Pack");
  });

  test("package prices derive from the base price unless set", () => {
    const levels = buildPackaging([
      { name: "Carton", contains: 10, sellingPrice: 45000 },
      { name: "Pack", contains: 10 },
      { name: "Tablet", contains: 1 },
    ]);
    const base = { purchasePrice: 30, sellingPrice: 50 };
    assert.equal(packagePrice(levels[0], base, "sellingPrice"), 45000, "carton has its own (discounted) price");
    assert.equal(packagePrice(levels[0], base, "purchasePrice"), 3000);
    assert.equal(packagePrice(levels[1], base, "sellingPrice"), 500);
    assert.equal(packagePrice(levels[2], base, "sellingPrice"), 50);
    assert.equal(packagePrice(levels[1], base, "wholesalePrice"), undefined);
  });
});

describe("Barcodes", () => {
  test("EAN-13 and UPC-A check digits", () => {
    assert.equal(gs1CheckDigit("400638133393"), 1); // 4006381333931
    assert.equal(barcodeError("4006381333931", "EAN13"), null);
    assert.match(barcodeError("4006381333932", "EAN13"), /check digit/);
    assert.match(barcodeError("12345", "EAN13"), /13 digits/);
    assert.equal(barcodeError("036000291452", "UPCA"), null);
    assert.match(barcodeError("036000291453", "UPCA"), /check digit/);
  });

  test("Code 128 accepts printable text", () => {
    assert.equal(barcodeError("PH-AMX-500/CTN", "CODE128"), null);
    assert.match(barcodeError("bad\u0001code", "CODE128"), /printable/);
  });

  test("detects the symbology from a scan", () => {
    assert.equal(detectBarcodeFormat("4006381333931"), "EAN13");
    assert.equal(detectBarcodeFormat("036000291452"), "UPCA");
    assert.equal(detectBarcodeFormat("4006381333932"), "CODE128", "bad check digit is not treated as EAN");
  });

  test("internal codes are valid in-store EAN-13 (prefix 29)", () => {
    const first = internalEan13(1);
    const second = internalEan13(2);
    assert.match(first, /^29\d{11}$/);
    assert.equal(barcodeError(first, "EAN13"), null);
    assert.notEqual(first, second);
  });
});
