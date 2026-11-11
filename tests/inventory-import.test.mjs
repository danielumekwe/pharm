// Bulk product and opening-stock import: preview, matching, duplicates, batches, packaging conversion, outlets,
// idempotency, chunked commit and recovery, rollback, permissions, tenant isolation and upload safety.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
let admin;
let outletCodes;
const B_OWNER = "owner@import-b.ng";

before(async () => {
  // Two rows per commit part, so multi-part imports (and failures between parts) are exercised.
  server = await startServer({ INVENTORY_IMPORT_CHUNK_ROWS: "2" });
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
  outletCodes = Object.fromEntries((await server.query("SELECT id, code FROM outlets WHERE tenant_id = 'tenant-demo'")).map((row) => [row.id, row.code]));
});
after(async () => {
  await server?.stop();
});

const days = (count) => new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);
const cell = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
const csv = (rows) => rows.map((row) => row.map(cell).join(",")).join("\n");
const OPTIONS = { outletId: "outlet-1", dateFormat: "DMY", priceBasis: "base" };
let unique = 0;

async function upload(client, content, kind = "both", name = `import-${++unique}.csv`) {
  const form = new FormData();
  form.append("file", new Blob([content]), name);
  form.append("kind", kind);
  const response = await fetch(`${server.baseUrl}/api/inventory-imports`, { method: "POST", headers: { cookie: client.cookieHeader() }, body: form });
  return { status: response.status, data: await response.json() };
}

/** Upload + preview with the automatic mapping. */
async function staged(client, content, { kind = "both", options = OPTIONS, decisions, edits, name } = {}) {
  const uploaded = await upload(client, content, kind, name);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  const preview = await client.post(`/api/inventory-imports/${uploaded.data.id}/preview`, { mapping: uploaded.data.mapping, options, decisions, edits });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  return preview.data;
}

async function commitAll(client, detail) {
  assert.ok(detail.chunkCount > 0, `nothing to import: ${JSON.stringify(detail.preview?.rows.map((row) => [row.status, row.action, ...row.errors, ...row.warnings]))}`);
  let last;
  for (let chunk = detail.nextChunk ?? 0; chunk < detail.chunkCount; chunk += 1) {
    last = await client.post(`/api/inventory-imports/${detail.id}/commit`, { confirm: true, token: detail.preview.token, chunk });
    if (last.status !== 200) return last;
  }
  return last;
}

async function assertLedgerHealthy() {
  const verify = await admin.get("/api/stock-ledger?verify=1");
  assert.equal(verify.status, 200, JSON.stringify(verify.data));
  assert.deepEqual(verify.data.mismatches, [], "cached balances match the ledger");
  const drift = await server.query(
    `SELECT b.id FROM batches b LEFT JOIN stock_ledger l ON l.batch_id = b.id GROUP BY b.id, b.available_quantity HAVING b.available_quantity <> COALESCE(SUM(l.base_quantity), 0)`,
  );
  assert.deepEqual(drift, [], "persisted batch balances match persisted ledger rows");
}

const productNamed = async (name, outletId = "outlet-1") => (await server.query("SELECT id, name, stock, outlet_id FROM products WHERE name = ? AND outlet_id = ?", name, outletId))[0];

const HEADER = ["Product Name", "Barcode", "SKU", "Category", "Dosage Form", "Strength", "Base Unit", "Packaging", "Cost Price", "Selling Price", "Batch No", "Expiry Date", "MFG Date", "Qty", "Quantity Unit"];

describe("Pages", () => {
  test("the import screen and history render for importers and are refused to others", async () => {
    const page = await (await admin.request("GET", "/inventory/import", undefined, { raw: true })).text();
    assert.match(page, /Bulk Import \/ Data Migration/);
    assert.match(page, /Upload and read file/);
    const history = await admin.request("GET", "/inventory/import/history", undefined, { raw: true });
    assert.equal(history.status, 200);
    assert.match(await history.text(), /Import History/);
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const denied = await cashier.request("GET", "/inventory/import", undefined, { raw: true });
    assert.equal(denied.status, 307);
    assert.match(denied.headers.get("location"), /denied/);
  });
});

describe("Templates", () => {
  test("Excel and CSV templates download with sample rows and a column guide", async () => {
    const xlsx = await admin.request("GET", "/api/inventory-imports/template?kind=both&format=xlsx", undefined, { raw: true });
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get("content-disposition"), /products-and-stock-template\.xlsx/);
    const bytes = new Uint8Array(await xlsx.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b], "a zip (xlsx) file");
    const text = await (await admin.request("GET", "/api/inventory-imports/template?kind=stock&format=csv", undefined, { raw: true })).text();
    assert.match(text, /Product Name,Barcode,SKU,Outlet,Batch Number,Manufacturing Date,Expiry Date,Quantity,Quantity Unit/);
  });

  test("the Excel template can be uploaded as it is and every column is recognised", async () => {
    const xlsx = await admin.request("GET", "/api/inventory-imports/template?kind=both&format=xlsx", undefined, { raw: true });
    const form = new FormData();
    form.append("file", new Blob([await xlsx.arrayBuffer()]), "template.xlsx");
    form.append("kind", "both");
    const response = await fetch(`${server.baseUrl}/api/inventory-imports`, { method: "POST", headers: { cookie: admin.cookieHeader() }, body: form });
    const data = await response.json();
    assert.equal(response.status, 201, JSON.stringify(data));
    assert.equal(data.rowCount, 4);
    assert.equal(Object.keys(data.mapping).length, data.headers.length, "every template column maps automatically");
    assert.equal(data.sample[0][data.mapping.expiryDate], "2028-12-31", "dates stay as typed (text cells)");
    assert.equal((await admin.delete(`/api/inventory-imports/${data.id}`)).status, 200, "an upload can be discarded");
  });
});

describe("New products with opening stock", () => {
  let detail;
  test("preview shows one product, three batches with their own expiry dates, and converted quantities; nothing is saved", async () => {
    const content = csv([
      HEADER,
      ["Zentrax 400mg Tablets", "", "ZTX-400", "Analgesics", "Tablet", "400mg", "Tablet", "Carton x10 > Pack x10 > Tablet", "5", "8", "zx-1", days(400), days(-30), "2", "Cartons"],
      ["Zentrax 400mg Tablets", "", "ZTX-400", "Analgesics", "Tablet", "400mg", "Tablet", "Carton x10 > Pack x10 > Tablet", "5.5", "8", "ZX-2", days(600), "", "15", "Pack"],
      ["Zentrax 400mg Tablets", "", "ZTX-400", "Analgesics", "Tablet", "400mg", "Tablet", "Carton x10 > Pack x10 > Tablet", "6", "8", "ZX-3", days(90), "", "7", ""],
    ]);
    detail = await staged(admin, content);
    const { summary, rows } = detail.preview;
    assert.equal(summary.newProducts, 1);
    assert.equal(summary.newBatches, 3);
    assert.equal(summary.openingQuantity, 200 + 150 + 7);
    assert.deepEqual(rows.map((row) => [row.batch.batchNumber, row.batch.quantity, row.batch.unit, row.batch.baseQuantity]), [["ZX-1", 2, "Carton", 200], ["ZX-2", 15, "Pack", 150], ["ZX-3", 7, "Tablet", 7]]);
    assert.match(rows[0].batch.conversion, /2 Carton × 100 = 200 Tablet/);
    assert.equal(summary.nearExpiryRows, 1, "the 90-day batch is flagged");
    assert.equal(rows[1].batch.unitCost, 5.5, "each batch keeps its own cost");
    assert.equal(await productNamed("Zentrax 400mg Tablets"), undefined, "preview writes nothing");
  });

  test("the commit creates the product and one batch per row through the stock ledger", async () => {
    const result = await commitAll(admin, detail);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.status, "COMPLETED");
    assert.equal(result.data.summary.productsCreated, 1);
    assert.equal(result.data.summary.batchesCreated, 3);
    assert.equal(result.data.summary.quantityImported, 357);
    const product = await productNamed("Zentrax 400mg Tablets");
    const view = (await admin.get(`/api/products/${product.id}`)).data;
    assert.equal(view.summary.opening, 357);
    assert.deepEqual(view.batches.map((batch) => [batch.batchNumber, batch.expiryDate, batch.availableQuantity]), [["ZX-3", days(90), 7], ["ZX-1", days(400), 200], ["ZX-2", days(600), 150]], "FEFO order: earliest expiry first, never merged");
    assert.ok(view.ledger.every((row) => row.type === "OPENING" && row.reference === detail.reference));
    assert.ok(view.ledger.some((row) => row.unit === "Carton" && row.quantity === 2 && row.baseQuantity === 200), "the original unit is kept on the ledger row");
    await assertLedgerHealthy();
  });

  test("re-importing the same file is refused, and a repeated commit request imports nothing twice", async () => {
    const again = await admin.post(`/api/inventory-imports/${detail.id}/commit`, { confirm: true, token: detail.preview.token, chunk: 0 });
    assert.equal(again.status, 200);
    assert.equal(again.data.repeated, true);
    const content = csv([HEADER, ["Dupcheck Syrup 100ml", "", "", "Cough & cold", "Syrup", "", "Bottle", "", "100", "150", "DS-1", days(300), "", "4", ""]]);
    const first = await staged(admin, content, { name: "same-file.csv" });
    assert.equal((await commitAll(admin, first)).status, 200);
    const second = await staged(admin, content, { name: "same-file-renamed.csv" });
    assert.equal(second.previous.reference, first.reference, "the preview warns that this file was imported before");
    const refused = await admin.post(`/api/inventory-imports/${second.id}/commit`, { confirm: true, token: second.preview.token, chunk: 0 });
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, new RegExp(`already imported as ${first.reference}`));
    assert.equal((await productNamed("Dupcheck Syrup 100ml")).stock, 4, "stock imported once");
  });
});

describe("Existing products", () => {
  let product;
  before(async () => {
    const created = await admin.post("/api/products", {
      name: "Matchol 250mg Capsules",
      category: "Antibiotics",
      dosageForm: "Capsule",
      strength: "250mg",
      outletId: "outlet-1",
      packaging: [{ name: "Pack", contains: 10 }, { name: "Capsule", contains: 1 }],
      pricing: { purchasePrice: 20, sellingPrice: 30 },
      barcodeMode: "manufacturer",
      barcodes: [{ code: "4006381333931", packagingIndex: 1 }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    product = created.data;
  });

  test("opening stock matches by barcode and converts with the product's own packaging", async () => {
    const detail = await staged(admin, csv([["Item Name", "EAN", "Lot Number", "Expiration Date", "Stock", "Stock Unit"], ["MATCHOL CAPS (old POS name)", "4006381333931", "MC-1", days(500), "3", "Packs"]]), { kind: "stock" });
    const [row] = detail.preview.rows;
    assert.equal(row.action, "match");
    assert.equal(row.productId, product.id);
    assert.equal(row.matchedBy, "barcode");
    assert.equal(row.batch.baseQuantity, 30);
    assert.equal(detail.preview.summary.matchedProducts, 1);
    assert.equal((await commitAll(admin, detail)).status, 200);
    assert.equal((await admin.get(`/api/products/${product.id}`)).data.summary.available, 30);
    await assertLedgerHealthy();
  });

  test("a conflicting conversion, an unknown unit and an existing batch number are rejected", async () => {
    const detail = await staged(
      admin,
      csv([
        ["Product Name", "Pack Size", "Batch No", "Expiry", "Qty", "Quantity Unit"],
        ["Matchol 250mg Capsules", "20", "MC-2", days(500), "1", "Pack"],
        ["Matchol 250mg Capsules", "", "MC-3", days(500), "1", "Carton"],
        ["Matchol 250mg Capsules", "", "MC-1", days(500), "1", "Pack"],
      ]),
      { kind: "stock" },
    );
    const [conflict, unknown, existing] = detail.preview.rows;
    assert.match(conflict.errors.join(), /1 Pack = 20 .* PharmaERP has 1 Pack = 10 Capsule/);
    assert.match(unknown.errors.join(), /Unit "Carton" is not a packaging level/);
    assert.match(existing.errors.join(), /Batch MC-1 of Matchol 250mg Capsules is already in PharmaERP/);
    assert.equal(detail.preview.summary.conversionIssues, 2);
  });

  test("an opening-stock import does not create products that are not in PharmaERP", async () => {
    const detail = await staged(admin, csv([["Product Name", "Batch No", "Expiry", "Qty"], ["Unknownex 5mg", "U-1", days(300), "5"]]), { kind: "stock" });
    assert.equal(detail.preview.rows[0].status, "error");
    assert.match(detail.preview.rows[0].errors[0], /not in PharmaERP/);
  });
});

describe("Duplicates", () => {
  test("similar names are shown side by side and need a decision; different strengths are never merged", async () => {
    const content = csv([
      ["Product Name", "Strength", "Category", "Cost Price", "Selling Price"],
      ["Zentrax 400mg Tabs", "400mg", "Analgesics", "5", "8"],
      ["Zentrax 200mg Tablets", "200mg", "Analgesics", "3", "5"],
    ]);
    const detail = await staged(admin, content, { kind: "catalogue" });
    const [similar, other] = detail.preview.rows;
    assert.equal(similar.status, "review");
    assert.equal(similar.candidates[0].name, "Zentrax 400mg Tablets");
    assert.equal(similar.incoming.name, "Zentrax 400mg Tabs");
    assert.equal(other.action, "create", "a different strength is a different medicine");
    const blocked = await admin.post(`/api/inventory-imports/${detail.id}/commit`, { confirm: true, token: detail.preview.token, chunk: 0 });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /possible duplicates/);

    const decided = await admin.post(`/api/inventory-imports/${detail.id}/preview`, { decisions: { 0: { action: "match", productId: similar.candidates[0].id } } });
    assert.equal(decided.status, 200);
    assert.equal(decided.data.preview.rows[0].action, "match");
    assert.equal(decided.data.preview.summary.reviewRows, 0);
    assert.equal(decided.data.preview.summary.newProducts, 1);
    assert.equal((await commitAll(admin, decided.data)).status, 200);
    const names = (await server.query("SELECT name FROM products WHERE name LIKE 'Zentrax%' AND outlet_id = 'outlet-1' ORDER BY name")).map((row) => row.name);
    assert.deepEqual(names, ["Zentrax 200mg Tablets", "Zentrax 400mg Tablets"], "no duplicate product was created");
  });

  test("the same batch listed twice is rejected, never combined", async () => {
    const detail = await staged(
      admin,
      csv([
        HEADER,
        ["Twinbatch 10mg", "", "", "Analgesics", "", "10mg", "Tablet", "", "2", "3", "TB-1", days(300), "", "10", ""],
        ["Twinbatch 10mg", "", "", "Analgesics", "", "10mg", "Tablet", "", "2", "3", "TB-1", days(500), "", "10", ""],
      ]),
    );
    assert.equal(detail.preview.rows[0].status, "ready");
    assert.match(detail.preview.rows[1].errors[0], /listed twice/);
  });
});

describe("Validation, corrections and reports", () => {
  test("invalid quantities, missing batch details and expired stock are rejected with reasons", async () => {
    const detail = await staged(
      admin,
      csv([
        HEADER,
        ["Validol 5mg", "", "", "Analgesics", "", "5mg", "Tablet", "", "2", "3", "V-1", days(300), "", "-5", ""],
        ["Validol 5mg", "", "", "Analgesics", "", "5mg", "Tablet", "", "2", "3", "V-2", days(300), "", "abc", ""],
        ["Validol 5mg", "", "", "Analgesics", "", "5mg", "Tablet", "", "2", "3", "", days(300), "", "5", ""],
        ["Validol 5mg", "", "", "Analgesics", "", "5mg", "Tablet", "", "2", "3", "V-4", days(-3), "", "5", ""],
        ["Validol 5mg", "", "", "Analgesics", "", "5mg", "Tablet", "", "2", "3", "V-5", "", "", "5", ""],
        ['=HYPERLINK("http://evil")', "", "", "Analgesics", "", "", "Tablet", "", "1", "0.5", "E-1", days(300), "", "1", ""],
      ]),
    );
    const errors = detail.preview.rows.map((row) => row.errors.join(" "));
    assert.match(errors[0], /cannot be negative/);
    assert.match(errors[1], /not a number/);
    assert.match(errors[2], /Batch number is missing/);
    assert.match(errors[3], /expired/);
    assert.match(errors[4], /Expiry date is missing/);
    assert.match(errors[5], /below cost/);
    assert.equal(detail.preview.summary.expiredRows, 1);
    assert.equal(detail.preview.summary.missingRequired, 2);

    const report = await (await admin.request("GET", `/api/inventory-imports/${detail.id}/report?type=rejected`, undefined, { raw: true })).text();
    assert.match(report, /^Row,Product Name/);
    assert.match(report, /cannot be negative/);
    assert.ok(report.includes(`"'=HYPERLINK(""http://evil"")"`), "formula cells are neutralised");

    // Correcting a row on the preview.
    const corrected = await admin.post(`/api/inventory-imports/${detail.id}/preview`, { edits: { 0: { quantity: "5" } } });
    assert.equal(corrected.data.preview.rows[0].status, "ready");
    assert.equal(corrected.data.preview.rows[0].edited, true);
  });

  test("illegal and malformed uploads are refused", async () => {
    const xls = await upload(admin, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), "both", "old.xls");
    assert.equal(xls.status, 400);
    assert.match(xls.data.error, /\.xls files are not supported/);
    const fake = await upload(admin, "not a zip", "both", "fake.xlsx");
    assert.match(fake.data.error, /not a valid \.xlsx/);
    const binary = await upload(admin, new Uint8Array([0x41, 0x00, 0x42]), "both", "bin.csv");
    assert.match(binary.data.error, /binary data/);
    const exe = await upload(admin, "MZ", "both", "tool.exe");
    assert.match(exe.data.error, /Upload an Excel/);
    const big = await upload(admin, new Uint8Array(4 * 1024 * 1024 + 10), "both", "big.csv");
    assert.equal(big.status, 413);
  });
});

describe("Outlets and permissions", () => {
  test("rows go to the outlet named in the file; unknown outlets are rejected", async () => {
    const detail = await staged(
      admin,
      csv([
        [...HEADER, "Outlet"],
        ["Multiout 1mg", "", "", "Analgesics", "", "1mg", "Tablet", "", "1", "2", "MO-1", days(300), "", "10", "", outletCodes["outlet-1"]],
        ["Multiout 1mg", "", "", "Analgesics", "", "1mg", "Tablet", "", "1", "2", "MO-2", days(300), "", "20", "", outletCodes["outlet-2"]],
        ["Multiout 1mg", "", "", "Analgesics", "", "1mg", "Tablet", "", "1", "2", "MO-3", days(300), "", "20", "", "NOWHERE"],
      ]),
    );
    assert.deepEqual(detail.preview.rows.map((row) => row.outletId ?? null), ["outlet-1", "outlet-2", null]);
    assert.match(detail.preview.rows[2].errors[0], /not one of this pharmacy's outlets/);
    assert.equal(detail.preview.summary.newProducts, 2, "one product record per outlet");
    assert.equal((await commitAll(admin, detail)).status, 200);
    assert.equal((await productNamed("Multiout 1mg", "outlet-1")).stock, 10);
    assert.equal((await productNamed("Multiout 1mg", "outlet-2")).stock, 20);
  });

  test("only importers can import; outlet stock managers are limited to their outlet", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    assert.equal((await upload(cashier, csv([["Product Name"], ["X"]]))).status, 403);
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    assert.equal((await upload(manager, csv([["Product Name"], ["X"]]))).status, 403, "Pharmacy Managers need the permission granted");

    const stock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const detail = await staged(
      stock,
      csv([
        [...HEADER, "Outlet"],
        ["Scopetest 2mg", "", "", "Analgesics", "", "2mg", "Tablet", "", "1", "2", "SC-1", days(300), "", "5", "", outletCodes["outlet-1"]],
        ["Scopetest 2mg", "", "", "Analgesics", "", "2mg", "Tablet", "", "1", "2", "SC-2", days(300), "", "5", "", outletCodes["outlet-2"]],
      ]),
    );
    assert.equal(detail.preview.rows[0].status, "ready");
    assert.match(detail.preview.rows[1].errors[0], /cannot import into/);
    assert.equal((await stock.post(`/api/inventory-imports/${detail.id}/preview`, { options: { ...OPTIONS, outletId: "outlet-2" } })).status, 403);
    const history = await stock.get("/api/inventory-imports");
    assert.ok(history.data.every((row) => row.outletId === "outlet-1"), "outlet staff see their outlet's imports only");
  });
});

describe("Failures, recovery and rollback", () => {
  test("a part that fails leaves nothing behind; earlier parts can be rolled back", async () => {
    // Three products, two rows per part: part 1 = Alpha + Beta, part 2 = Gamma.
    const detail = await staged(
      admin,
      csv([
        HEADER,
        ["Recov Alpha 1mg", "", "", "Analgesics", "", "1mg", "Tablet", "", "1", "2", "RA-1", days(300), "", "10", ""],
        ["Recov Beta 1mg", "", "", "Analgesics", "", "1mg", "Tablet", "", "1", "2", "RB-1", days(300), "", "10", ""],
        ["Recov Gamma 1mg", "", "", "Analgesics", "", "1mg", "Tablet", "", "1", "2", "RG-1", days(300), "", "10", ""],
      ]),
    );
    assert.equal(detail.chunkCount, 2);
    const first = await admin.post(`/api/inventory-imports/${detail.id}/commit`, { confirm: true, token: detail.preview.token, chunk: 0 });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.status, "IN_PROGRESS");
    // Someone registers Gamma by hand before part 2 runs.
    const manual = await admin.post("/api/products", { name: "Recov Gamma 1mg", category: "Analgesics", outletId: "outlet-1", packaging: [{ name: "Tablet", contains: 1 }], pricing: { purchasePrice: 1, sellingPrice: 2 }, barcodeMode: "none" });
    assert.equal(manual.status, 201, JSON.stringify(manual.data));
    const second = await admin.post(`/api/inventory-imports/${detail.id}/commit`, { confirm: true, token: detail.preview.token, chunk: 1 });
    assert.equal(second.status, 409);
    assert.match(second.data.error, /changed since the preview/);
    assert.equal((await productNamed("Recov Gamma 1mg")).stock, 0, "the failed part imported nothing");
    assert.equal((await admin.get(`/api/inventory-imports/${detail.id}`)).data.nextChunk, 1);
    await assertLedgerHealthy();

    const rollback = await admin.post(`/api/inventory-imports/${detail.id}/rollback`, { reason: "Part 2 conflicted" });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.data));
    assert.equal(rollback.data.removedProducts, 2);
    assert.equal(await productNamed("Recov Alpha 1mg"), undefined);
    assert.equal(await productNamed("Recov Beta 1mg"), undefined);
    assert.ok(await productNamed("Recov Gamma 1mg"), "the hand-registered product is untouched");
    await assertLedgerHealthy();
    const audit = await server.query("SELECT summary FROM audit_events WHERE action = 'inventory.import.rollback' AND entity_id = ?", detail.reference);
    assert.match(audit[0].summary, /Reason: Part 2 conflicted/);
  });

  test("rollback reverses stock added to existing products through the ledger", async () => {
    const product = await productNamed("Matchol 250mg Capsules");
    const before = (await admin.get(`/api/products/${product.id}`)).data.summary.available;
    const detail = await staged(admin, csv([["Product Name", "Batch No", "Expiry", "Qty", "Quantity Unit"], ["Matchol 250mg Capsules", "MC-RB", days(400), "2", "Pack"]]), { kind: "stock" });
    assert.equal((await commitAll(admin, detail)).status, 200);
    assert.equal((await admin.get(`/api/products/${product.id}`)).data.summary.available, before + 20);
    const rollback = await admin.post(`/api/inventory-imports/${detail.id}/rollback`, { reason: "Wrong count" });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.data));
    const view = (await admin.get(`/api/products/${product.id}`)).data;
    assert.equal(view.summary.available, before);
    assert.ok(view.ledger.some((row) => row.type === "ADJUSTMENT_OUT" && row.reference === detail.reference && /Rollback of import/.test(row.remarks)), "reversal is a ledger entry");
    assert.ok(view.ledger.some((row) => row.type === "OPENING" && row.reference === detail.reference), "the original entry stays");
    assert.equal((await admin.post(`/api/inventory-imports/${detail.id}/rollback`, { reason: "Again please" })).status, 409, "cannot roll back twice");
    await assertLedgerHealthy();
  });

  test("rollback is refused once imported stock has been used", async () => {
    const detail = await staged(admin, csv([HEADER, ["Usedup 3mg", "", "", "Analgesics", "", "3mg", "Tablet", "", "1", "2", "UU-1", days(300), "", "50", ""]]));
    assert.equal((await commitAll(admin, detail)).status, 200);
    const product = await productNamed("Usedup 3mg");
    const movement = await admin.post("/api/stock-movements", { type: "Adjustment", productId: product.id, quantity: 5, reason: "Damaged" });
    assert.equal(movement.status, 201, JSON.stringify(movement.data));
    assert.equal((await admin.patch(`/api/inventory/${movement.data.id}`, { status: "Approved" })).status, 200);
    const refused = await admin.post(`/api/inventory-imports/${detail.id}/rollback`, { reason: "Changed my mind" });
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, /corrective stock adjustment/);
    assert.equal((await productNamed("Usedup 3mg")).stock, 45, "nothing was removed");
    await assertLedgerHealthy();
  });
});

describe("Concurrency", () => {
  test("an import and other stock operations at the same time keep every balance correct", async () => {
    const detail = await staged(admin, csv([HEADER, ["Parallel 9mg", "", "", "Analgesics", "", "9mg", "Tablet", "", "1", "2", "PA-1", days(300), "", "100", ""]]));
    const product = await productNamed("Matchol 250mg Capsules");
    const request = { confirm: true, token: detail.preview.token, chunk: 0 };
    const batchId = (await admin.get(`/api/products/${product.id}`)).data.batches[0].id;
    const [a, b, adjustment] = await Promise.all([
      admin.post(`/api/inventory-imports/${detail.id}/commit`, request),
      admin.post(`/api/inventory-imports/${detail.id}/commit`, request),
      admin.post("/api/stock-movements", { type: "Adjustment", direction: "IN", productId: product.id, batchId, quantity: 3, reason: "Count surplus" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 200]);
    assert.equal([a, b].filter((response) => response.data.repeated).length, 1, "the second identical request did nothing");
    assert.equal(adjustment.status, 201);
    assert.equal((await productNamed("Parallel 9mg")).stock, 100);
    assert.equal((await server.query("SELECT COUNT(*)::int AS n FROM batches WHERE batch_number = 'PA-1'"))[0].n, 1);
    await assertLedgerHealthy();
  });
});

describe("Tenant isolation", () => {
  let owner;
  let demoImport;
  before(async () => {
    const [account] = await server.query("SELECT password, password_hash FROM users WHERE email = 'admin@web365.ng'");
    await server.query("INSERT INTO tenants (id, slug, name) VALUES ('tenant-imp', 'import-b', 'Import B')");
    await server.query("INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle) VALUES ('sub-tenant-imp', 'tenant-imp', 'starter', 'ACTIVE', 'MONTHLY')");
    await server.query("INSERT INTO outlets (id, tenant_id, name, code, status, seq) VALUES ('outlet-imp1', 'tenant-imp', 'Import B Main', 'IMPB', 'OPEN', 1)");
    await server.query("INSERT INTO users (id, name, email, role, status, password, password_hash, seq) VALUES ('user-imp1', 'Import B Owner', ?, 'SUPER_ADMIN', 'ACTIVE', ?, ?, 998)", B_OWNER, account.password, account.password_hash);
    await server.query("INSERT INTO tenant_memberships (id, tenant_id, user_id, role, staff_id) VALUES ('mem-tenant-imp-user-imp1', 'tenant-imp', 'user-imp1', 'SUPER_ADMIN', 'IMP-0001')");
    await server.query("INSERT INTO app_state (tenant_id, key, value) VALUES ('tenant-imp', 'settings', ?)", JSON.stringify({ businessName: "Import B" }));
    owner = await signedIn(server.baseUrl, B_OWNER);
    demoImport = (await admin.get("/api/inventory-imports")).data[0];
  });

  test("another pharmacy cannot see, change, commit or roll back an import, nor import into our outlets", async () => {
    assert.ok(demoImport);
    const history = await owner.get("/api/inventory-imports");
    assert.equal(history.status, 200);
    assert.deepEqual(history.data, []);
    for (const [method, path, body] of [
      ["GET", `/api/inventory-imports/${demoImport.id}`],
      ["POST", `/api/inventory-imports/${demoImport.id}/preview`, { options: OPTIONS }],
      ["POST", `/api/inventory-imports/${demoImport.id}/commit`, { confirm: true, token: "x", chunk: 0 }],
      ["POST", `/api/inventory-imports/${demoImport.id}/rollback`, { reason: "not mine" }],
      ["GET", `/api/inventory-imports/${demoImport.id}/report?type=all`],
    ]) {
      const response = await owner.request(method, path, body);
      assert.equal(response.status, 404, `${method} ${path}`);
    }
    const own = await upload(owner, csv([HEADER, ["Tenant B Drug", "", "", "Analgesics", "", "", "Tablet", "", "1", "2", "TB-1", days(300), "", "5", ""]]));
    assert.equal(own.status, 201, JSON.stringify(own.data));
    const intoDemo = await owner.post(`/api/inventory-imports/${own.data.id}/preview`, { mapping: own.data.mapping, options: OPTIONS });
    assert.equal(intoDemo.status, 404);
    assert.match(intoDemo.data.error, /not one of this pharmacy's outlets/);
    const viaColumn = await owner.post(`/api/inventory-imports/${own.data.id}/preview`, { mapping: own.data.mapping, options: { ...OPTIONS, outletId: "outlet-imp1" }, edits: { 0: { outlet: outletCodes["outlet-1"] } } });
    assert.equal(viaColumn.status, 200, JSON.stringify(viaColumn.data));
    assert.match(viaColumn.data.preview.rows[0].errors[0], /not one of this pharmacy's outlets/, "a demo outlet code in the file does not reach the demo pharmacy");
    const rows = await server.query("SELECT tenant_id FROM inventory_imports WHERE id = ?", own.data.id);
    assert.equal(rows[0].tenant_id, "tenant-imp");
  });
});
