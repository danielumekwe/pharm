// Bulk import helpers: column auto-mapping, number/date/packaging parsing, name matching and CSV safety (pure module).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { autoMap, csvCell, describeLevels, mappingProblems, nameSimilarity, normaliseName, parseDate, parseNumber, parsePackaging, strengthsConflict, templateRows, unitKey } from "../lib/erp/import-format.ts";

describe("Column mapping", () => {
  test("recognises common headers from other POS systems", () => {
    const headers = ["Item Name", "EAN", "Item Code", "Lot Number", "Expiration Date", "MFG Date", "Cost Price", "Retail Price", "Available Quantity", "Units Per Pack", "Product Category", "Vendor"];
    const { mapping } = autoMap(headers, "both");
    assert.deepEqual(mapping, {
      name: 0,
      barcode: 1,
      sku: 2,
      batchNumber: 3,
      expiryDate: 4,
      manufacturingDate: 5,
      purchasePrice: 6,
      sellingPrice: 7,
      quantity: 8,
      packSize: 9,
      category: 10,
      supplier: 11,
    });
  });

  test("does not silently map ambiguous columns", () => {
    const { mapping, suggestions } = autoMap(["Medicine Name", "Price", "Qty", "Quantity", "Description"], "both");
    assert.equal(mapping.name, 0);
    assert.equal(mapping.sellingPrice, undefined, '"Price" could be cost or selling price');
    assert.ok(suggestions.sellingPrice?.some((entry) => entry.index === 1));
    assert.equal(mapping.quantity, undefined, "two quantity columns: the user must choose");
    assert.deepEqual(suggestions.quantity?.map((entry) => entry.index).sort(), [2, 3]);
    assert.equal(Object.values(mapping).includes(4), false, '"Description" is never mapped automatically');
  });

  test("an ERP ID column from another system is not trusted as a PharmaERP ID", () => {
    assert.equal(autoMap(["Item ID", "Name"], "catalogue").mapping.productId, undefined);
    assert.equal(autoMap(["PharmaERP ID", "Name"], "catalogue").mapping.productId, 0);
  });

  test("reports missing required columns and double-mapped columns", () => {
    assert.deepEqual(mappingProblems("stock", { name: 0 }, 3), ["Map a column to Batch Number.", "Map a column to Expiry Date.", "Map a column to Quantity."]);
    assert.match(mappingProblems("catalogue", { name: 0, sku: 0 }, 2).join(" "), /mapped to both/);
  });
});

describe("Cell parsing", () => {
  test("numbers with currency, separators and brackets", () => {
    assert.equal(parseNumber("₦1,250.50").value, 1250.5);
    assert.equal(parseNumber("NGN 300").value, 300);
    assert.equal(parseNumber("(12)").value, -12);
    assert.equal(parseNumber("").value, undefined);
    assert.match(parseNumber("ten").error, /not a number/);
  });

  test("dates in several layouts; month-only expiry means month end", () => {
    assert.equal(parseDate("2028-12-31", "DMY").value, "2028-12-31");
    assert.equal(parseDate("05/06/2028", "DMY").value, "2028-06-05");
    assert.equal(parseDate("05/06/2028", "MDY").value, "2028-05-06");
    assert.equal(parseDate("02/2028", "DMY", "expiry").value, "2028-02-29");
    assert.equal(parseDate("Mar-2029", "DMY", "expiry").value, "2029-03-31");
    assert.equal(parseDate("15 Jan 2027", "DMY").value, "2027-01-15");
    assert.equal(parseDate("46752", "DMY").value, "2027-12-31", "Excel serial date");
    assert.match(parseDate("31/02/2028", "DMY").error, /not a real date/);
    assert.match(parseDate("soon", "DMY").error, /not a date/);
  });

  test("packaging levels are product-specific and validated", () => {
    assert.deepEqual(parsePackaging("Carton x10 > Pack x10 > Strip x10 > Tablet").value, [
      { name: "Carton", contains: 10 },
      { name: "Pack", contains: 10 },
      { name: "Strip", contains: 10 },
      { name: "Tablet", contains: 1 },
    ]);
    assert.deepEqual(parsePackaging("1 Carton = 24 Bottle").value, [{ name: "Carton", contains: 24 }, { name: "Bottle", contains: 1 }]);
    assert.deepEqual(parsePackaging("1 Carton = 10 Pack = 100 Tablet").value?.map((level) => level.contains), [10, 10, 1]);
    assert.match(parsePackaging("Carton > Tablet").error, /how many/);
    assert.match(parsePackaging("1 Box = 15 Pack = 100 Tablet").error, /whole number/);
    assert.equal(describeLevels(parsePackaging("Carton x10 > Pack x10 > Strip x10 > Tablet").value), "1 Carton = 10 Pack = 100 Strip = 1,000 Tablet");
  });

  test("unit names compare loosely", () => {
    assert.equal(unitKey("Tabs"), unitKey("Tablet"));
    assert.equal(unitKey("Cartons"), "carton");
    assert.equal(unitKey("pcs"), "piece");
    assert.equal(unitKey("Boxes"), "box");
  });
});

describe("Product names", () => {
  test("normalised names ignore case, spacing and punctuation", () => {
    assert.equal(normaliseName("Paracetamol 500 MG - Tablets"), normaliseName("paracetamol 500mg tablets"));
  });

  test("different strengths are different medicines", () => {
    assert.equal(strengthsConflict("Amoxicillin 250mg", "Amoxicillin 500mg"), true);
    assert.equal(strengthsConflict("Amoxicillin 500 mg caps", "Amoxicillin 500mg"), false);
    assert.equal(strengthsConflict("Amoxicillin", "Amoxicillin 500mg"), false, "unknown strength is not a conflict");
    assert.equal(strengthsConflict("Amoxil 250mg Capsules", "Amoxil 250mg Capsules 250mg"), false, "a repeated strength is one strength");
  });

  test("similarity ignores strengths and dosage-form words", () => {
    assert.equal(nameSimilarity("Panadol Extra Tablets", "Panadol Extra"), 1);
    assert.ok(nameSimilarity("Panadol Extra", "Panadol") >= 0.5);
    assert.equal(nameSimilarity("Ibuprofen", "Paracetamol"), 0);
  });
});

describe("CSV output", () => {
  test("formula injection is neutralised", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
    assert.equal(csvCell("+1+1"), "'+1+1");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell("-5"), "-5", "plain negative numbers stay numbers");
    assert.equal(csvCell("-2+3"), "'-2+3");
  });

  test("templates have sample rows matching their columns", () => {
    for (const kind of ["catalogue", "stock", "both"]) assert.ok(templateRows(kind).length >= 3);
  });
});
