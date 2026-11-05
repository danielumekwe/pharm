// Product registration, packaging, batch tracking (FEFO), the stock ledger and outlet isolation.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
let admin;
before(async () => {
  server = await startServer();
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
});
after(async () => {
  await server?.stop();
});

const days = (count) => new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);
const CARTON_EAN = "4006381333931";

/** Asserts every cached balance (batch + item) equals the sum of its ledger rows, in memory and in PostgreSQL. */
async function assertLedgerHealthy(client = admin) {
  const verify = await client.get("/api/stock-ledger?verify=1");
  assert.equal(verify.status, 200, JSON.stringify(verify.data));
  assert.deepEqual(verify.data.mismatches, [], "cached balances match the ledger");
  const drift = await server.query(
    `SELECT b.id, b.available_quantity, COALESCE(SUM(l.base_quantity), 0) AS ledger
       FROM batches b LEFT JOIN stock_ledger l ON l.batch_id = b.id
      GROUP BY b.id, b.available_quantity
     HAVING b.available_quantity <> COALESCE(SUM(l.base_quantity), 0)`,
  );
  assert.deepEqual(drift, [], "persisted batch balances match persisted ledger rows");
}

function registration(overrides = {}) {
  return {
    name: "Amoxiclav 625mg Tablets",
    genericName: "Amoxicillin + Clavulanic acid",
    category: "Antibiotics",
    productType: "Prescription medicine (POM)",
    dosageForm: "Tablet",
    strength: "625mg",
    manufacturer: "GSK Nigeria",
    outletId: "outlet-1",
    rxOnly: false,
    minStock: 100,
    packaging: [
      { name: "Carton", contains: 10, sellingPrice: 45000 },
      { name: "Pack", contains: 10 },
      { name: "Strip", contains: 10 },
      { name: "Tablet", contains: 1 },
    ],
    pricing: { purchasePrice: 30, sellingPrice: 50, minSellingPrice: 40 },
    barcodeMode: "manufacturer",
    barcodes: [{ code: CARTON_EAN, packagingIndex: 0 }],
    regulatory: { nafdacNumber: "A4-77001", status: "Registered", approvalDate: "2024-01-10", expiryDate: "2029-01-09", localRepresentative: "GSK Nigeria Plc" },
    openingStock: [
      { batchNumber: "AMC-LATE", manufacturingDate: days(-60), expiryDate: days(700), packagingIndex: 0, quantity: 1 }, // 1 carton = 1,000
      { batchNumber: "AMC-EARLY", manufacturingDate: days(-300), expiryDate: days(200), packagingIndex: 1, quantity: 3, unitCost: 2800 }, // 3 packs = 300
    ],
    ...overrides,
  };
}

let product;

describe("Product registration", () => {
  test("registers a product with packaging conversions, barcodes, regulatory data and opening batches", async () => {
    const { status, data } = await admin.post("/api/products", registration());
    assert.equal(status, 201, JSON.stringify(data));
    product = data;
    assert.deepEqual(product.packaging.map((level) => [level.name, level.unitsPerPackage]), [["Carton", 1000], ["Pack", 100], ["Strip", 10], ["Tablet", 1]]);
    assert.equal(product.baseUnit, "Tablet");
    assert.equal(product.stock, 1300, "1 carton + 3 packs = 1,300 tablets");
    assert.equal(product.barcodes[0].format, "EAN13");
    assert.equal(product.barcodes[0].packagingId, product.packaging[0].id, "barcode belongs to the carton");

    const detail = (await admin.get(`/api/products/${product.id}`)).data;
    assert.equal(detail.summary.opening, 1300);
    assert.equal(detail.summary.available, 1300);
    assert.deepEqual(detail.batches.map((batch) => [batch.batchNumber, batch.availableQuantity]), [["AMC-EARLY", 300], ["AMC-LATE", 1000]]);
    assert.equal(detail.batches[0].purchasePrice, 28, "pack cost 2,800 ÷ 100 = ₦28 per tablet");
    assert.equal(detail.batches[0].regulatoryNumber, "A4-77001", "batch inherits the NAFDAC number");
    assert.equal(detail.registration.localRepresentative, "GSK Nigeria Plc");
    assert.equal(detail.prices.find((row) => row.name === "Strip").sellingPrice, 500, "strip price derived from the base price");
    assert.equal(detail.prices.find((row) => row.name === "Carton").sellingPrice, 45000, "carton keeps its own price");
    assert.equal(detail.ledger.length, 2);
    assert.ok(detail.ledger.every((row) => row.type === "OPENING" && row.userName));
    assert.ok(detail.ledger.some((row) => row.unit === "Carton" && row.quantity === 1 && row.baseQuantity === 1000), "unit and base-unit equivalent recorded");
    await assertLedgerHealthy();
  });

  test("validates barcodes, packaging, pricing and batch dates with clear messages", async () => {
    const badCheck = await admin.post("/api/products", registration({ name: "Bad barcode", barcodes: [{ code: "4006381333932", format: "EAN13" }], openingStock: [] }));
    assert.equal(badCheck.status, 400);
    assert.match(badCheck.data.error, /check digit/);

    const duplicate = await admin.post("/api/products", registration({ name: "Someone else", openingStock: [] }));
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.data.error, /already used by Amoxiclav/);

    const packaging = await admin.post("/api/products", registration({ name: "Bad pack", barcodeMode: "none", openingStock: [], packaging: [{ name: "Pack", contains: 1 }, { name: "Tablet", contains: 1 }] }));
    assert.equal(packaging.status, 400);
    assert.match(packaging.data.error, /2 or more/);

    const belowCost = await admin.post("/api/products", registration({ name: "Below cost", barcodeMode: "none", openingStock: [], pricing: { purchasePrice: 60, sellingPrice: 50 } }));
    assert.equal(belowCost.status, 400);
    assert.match(belowCost.data.error, /below cost/);

    const expired = await admin.post("/api/products", registration({ name: "Expired opening", barcodeMode: "none", openingStock: [{ batchNumber: "OLD-1", manufacturingDate: days(-800), expiryDate: days(-1), quantity: 5 }] }));
    assert.equal(expired.status, 400);
    assert.match(expired.data.error, /expired/);
  });

  test("generates internal barcodes and derives base prices from a package price", async () => {
    const { status, data } = await admin.post("/api/products", {
      ...registration({ name: "Vitamin C Sachets", category: "Vitamins & supplements", dosageForm: "Sachet", openingStock: [], regulatory: {} }),
      packaging: [{ name: "Box", contains: 50, purchasePrice: 2500, sellingPrice: 4000 }, { name: "Sachet", contains: 1 }],
      pricing: {},
      barcodeMode: "internal",
      barcodes: [{ packagingIndex: 0 }, { packagingIndex: 1 }],
    });
    assert.equal(status, 201, JSON.stringify(data));
    assert.equal(data.purchasePrice, 50, "2,500 per box ÷ 50");
    assert.equal(data.sellingPrice, 80);
    assert.equal(data.barcodes.length, 2);
    assert.ok(data.barcodes.every((row) => /^29\d{11}$/.test(row.code) && row.source === "INTERNAL"));
    assert.equal(data.nafdacNumber, "Pending");
  });
});

describe("Barcode scanning, FEFO sales and the stock ledger", () => {
  let sale;

  test("scanning the carton barcode identifies the product and packaging level", async () => {
    const { status, data } = await admin.get(`/api/barcodes?code=${CARTON_EAN}&outletId=outlet-1`);
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data[0].productId, product.id);
    assert.equal(data[0].packaging, "Carton");
    assert.equal(data[0].unitsPerPackage, 1000);
    assert.equal((await admin.get(`/api/barcodes?code=${CARTON_EAN}&outletId=outlet-2`)).status, 404, "not stocked at outlet 2");
  });

  test("sells by strip and pack, first-expiry-first-out, at package prices", async () => {
    const [carton, pack, strip] = product.packaging;
    void carton;
    const response = await admin.post("/api/sales", {
      outletId: "outlet-1",
      customerId: null,
      paymentMethod: "Cash",
      lines: [
        { productId: product.id, packagingId: strip.id, quantity: 2 },
        { productId: product.id, packagingId: pack.id, quantity: 3 },
      ],
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    sale = response.data;
    assert.deepEqual(sale.lines.map((line) => [line.packagingName, line.packQuantity, line.quantity, line.packPrice]), [["Strip", 2, 20, 500], ["Pack", 3, 300, 5000]]);
    assert.equal(sale.subtotal, 2 * 500 + 3 * 5000);
    // 320 tablets: all 300 of the early batch, then 20 from the later one.
    const allocations = sale.lines.flatMap((line) => line.allocations);
    const byBatch = Object.fromEntries(allocations.reduce((map, row) => map.set(row.batchNumber, (map.get(row.batchNumber) ?? 0) + row.quantity), new Map()));
    assert.deepEqual(byBatch, { "AMC-EARLY": 300, "AMC-LATE": 20 });

    const ledger = (await admin.get(`/api/stock-ledger?productId=${product.id}&type=SALE`)).data;
    assert.equal(ledger.rows.reduce((sum, row) => sum + row.baseQuantity, 0), -320);
    assert.ok(ledger.rows.every((row) => row.reference === sale.number && row.newBalance === row.previousBalance + row.baseQuantity));
    assert.equal(ledger.summary.available, 980);
    await assertLedgerHealthy();
  });

  test("blocks a discount below the minimum selling price and overselling", async () => {
    const strip = product.packaging[2];
    const cheap = await admin.post("/api/sales", { outletId: "outlet-1", customerId: null, paymentMethod: "Cash", lines: [{ productId: product.id, packagingId: strip.id, quantity: 1, discount: 200 }] });
    assert.equal(cheap.status, 400);
    assert.match(cheap.data.error, /minimum/);
    const tooMany = await admin.post("/api/sales", { outletId: "outlet-1", customerId: null, paymentMethod: "Cash", lines: [{ productId: product.id, packagingId: product.packaging[0].id, quantity: 1 }] });
    assert.equal(tooMany.status, 400, "1 carton = 1,000 > 980 available");
  });

  test("quarantined batches are excluded from sale until released", async () => {
    const detail = (await admin.get(`/api/products/${product.id}`)).data;
    const late = detail.batches.find((batch) => batch.batchNumber === "AMC-LATE");
    assert.equal((await admin.patch(`/api/batches/${late.id}`, { action: "quarantine", note: "Suspected recall notice" })).status, 200);
    const blocked = await admin.post("/api/sales", { outletId: "outlet-1", customerId: null, paymentMethod: "Cash", lines: [{ productId: product.id, quantity: 1 }] });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /quarantined/);
    assert.equal((await admin.patch(`/api/batches/${late.id}`, { action: "release", note: "Recall did not cover this lot" })).status, 200);
  });

  test("voiding the sale returns units to the exact batches and keeps the ledger balanced", async () => {
    const response = await admin.patch(`/api/sales/${sale.id}`, { action: "void", reason: "Test reversal" });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const detail = (await admin.get(`/api/products/${product.id}`)).data;
    assert.deepEqual(detail.batches.map((batch) => [batch.batchNumber, batch.availableQuantity]), [["AMC-EARLY", 300], ["AMC-LATE", 1000]]);
    assert.equal(detail.summary.sold, 320);
    assert.equal(detail.summary.returned, 320);
    assert.equal(detail.summary.available, 1300);
    await assertLedgerHealthy();
  });

  test("price changes are kept in history without altering past sales", async () => {
    const strip = product.packaging[2];
    const changed = await admin.patch(`/api/products/${product.id}`, { pricing: { sellingPrice: 60 }, levelPrices: { [strip.id]: { sellingPrice: 550 } } });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    const detail = (await admin.get(`/api/products/${product.id}`)).data;
    assert.ok(detail.priceHistory.some((row) => row.kind === "selling" && row.oldValue === 50 && row.newValue === 60));
    assert.ok(detail.priceHistory.some((row) => row.level === "Strip" && row.newValue === 550));
    const [line] = await server.query("SELECT pack_price FROM sale_lines WHERE sale_id = ? AND packaging_name = 'Strip'", sale.id);
    assert.equal(line.pack_price, 500, "the old invoice keeps its price");
    const rows = await server.query("SELECT COUNT(*) AS n FROM price_history WHERE product_id = ?", product.id);
    assert.ok(rows[0].n >= 3, "price history is persisted");
  });

  test("transfers move batches between outlets with matching ledger entries", async () => {
    const legacy = await admin.post("/api/stock-movements", { type: "Transfer", productId: product.id, quantity: 150, toOutletId: "outlet-2", reason: "Rebalance" });
    assert.equal(legacy.status, 400, "inter-outlet moves must use the transfer workflow");
    const created = await admin.post("/api/transfers", { fromOutletId: "outlet-1", toOutletId: "outlet-2", lines: [{ productId: product.id, quantity: 150 }], notes: "Rebalance" });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const transfer = created.data;
    for (const action of ["approve", "dispatch"]) assert.equal((await admin.patch(`/api/transfers/${transfer.id}`, { action })).status, 200, action);
    const dispatched = (await admin.get("/api/transfers")).data.find((row) => row.id === transfer.id);
    const lines = dispatched.lines.flatMap((line) => line.dispatched.map((batch) => ({ productId: line.productId, batchNumber: batch.batchNumber, quantity: batch.quantity })));
    const received = await admin.patch(`/api/transfers/${transfer.id}`, { action: "receive", lines });
    assert.equal(received.status, 200, JSON.stringify(received.data));
    assert.equal(received.data.status, "Received");

    const outRows = (await admin.get(`/api/stock-ledger?productId=${product.id}&type=TRANSFER_OUT`)).data.rows;
    assert.deepEqual(outRows.map((row) => [row.batchNumber, row.baseQuantity]), [["AMC-EARLY", -150]], "FEFO: earliest expiry leaves first");
    const inRows = (await admin.get(`/api/stock-ledger?type=TRANSFER_IN&outletId=outlet-2`)).data.rows.filter((row) => row.reference === transfer.reference);
    assert.deepEqual(inRows.map((row) => [row.batchNumber, row.baseQuantity]), [["AMC-EARLY", 150]], "same batch number and expiry at the destination");
    const destination = (await admin.get(`/api/products/${inRows[0].productId}`)).data;
    assert.equal(destination.product.outletId, "outlet-2");
    assert.equal(destination.summary.available, 150);
    assert.equal(destination.product.packaging.length, 4, "packaging travels with the item");
    await assertLedgerHealthy();
  });

  test("approved adjustments and write-offs post to the ledger; balances cannot be edited directly", async () => {
    const detail = (await admin.get(`/api/products/${product.id}`)).data;
    const late = detail.batches.find((batch) => batch.batchNumber === "AMC-LATE");
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    const plus = await manager.post("/api/stock-movements", { type: "Adjustment", direction: "IN", batchId: late.id, productId: product.id, quantity: 7, reason: "Count surplus" });
    assert.equal(plus.status, 201, JSON.stringify(plus.data));
    const minus = await manager.post("/api/stock-movements", { type: "Adjustment", productId: product.id, quantity: 5, reason: "Damaged / broken" });
    assert.equal(minus.status, 201);
    for (const movement of [plus.data, minus.data]) assert.equal((await admin.patch(`/api/inventory/${movement.id}`, { status: "Approved" })).status, 200);
    const after = (await admin.get(`/api/products/${product.id}`)).data;
    assert.equal(after.summary.adjustments, 2);
    assert.equal(after.summary.available, 1300 - 150 + 7 - 5);

    // There is no API to set a balance: stock fields are ignored by the product update.
    await admin.patch(`/api/products/${product.id}`, { stock: 99999 });
    assert.equal((await admin.get(`/api/products/${product.id}`)).data.summary.available, 1152);
    await assertLedgerHealthy();
  });
});

describe("Outlet isolation", () => {
  test("outlet staff cannot read or change another outlet's inventory", async () => {
    const ikejaStock = await signedIn(server.baseUrl, "store@web365.ng", "outlet-2");
    assert.equal((await ikejaStock.get(`/api/products/${product.id}`)).status, 403);
    const register = await ikejaStock.post("/api/products", registration({ name: "Sneaky", barcodeMode: "none", openingStock: [] }));
    assert.equal(register.status, 403, "cannot register at outlet 1");
    const detail = (await admin.get(`/api/products/${product.id}`)).data;
    assert.equal((await ikejaStock.patch(`/api/batches/${detail.batches[1].id}`, { action: "quarantine", note: "not mine" })).status, 403);
    assert.equal((await ikejaStock.post("/api/stock-movements", { type: "Issue", productId: product.id, quantity: 1, reason: "test" })).status, 403);
    assert.equal((await ikejaStock.get(`/api/barcodes?code=${CARTON_EAN}&outletId=outlet-1`)).status, 403);

    const ledger = (await ikejaStock.get("/api/stock-ledger")).data;
    assert.ok(ledger.rows.length > 0);
    assert.ok(ledger.rows.every((row) => row.outletId === "outlet-2"), "ledger is limited to the active outlet");
    const products = (await ikejaStock.get("/api/products")).data;
    assert.ok(products.every((row) => row.outletId === "outlet-2"));
  });

  test("an outlet stock manager registers items with opening stock at their own outlet", async () => {
    const lekkiStock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const created = await lekkiStock.post("/api/products", registration({ name: "Cough Syrup 100ml", category: "Cough & cold", dosageForm: "Syrup", barcodeMode: "none", packaging: [{ name: "Carton", contains: 24 }, { name: "Bottle", contains: 1 }], pricing: { purchasePrice: 900, sellingPrice: 1300 }, openingStock: [{ batchNumber: "CS-1", manufacturingDate: days(-30), expiryDate: days(400), packagingIndex: 0, quantity: 2 }] }));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.stock, 48);
    assert.equal(created.data.outletId, "outlet-1");
  });

  test("super admin sees consolidated and per-outlet ledgers; catalogue lists need central rights", async () => {
    const all = (await admin.get("/api/stock-ledger")).data;
    assert.ok(new Set(all.rows.map((row) => row.outletId)).size >= 2, "consolidated view spans outlets");
    const one = (await admin.get("/api/stock-ledger?outletId=outlet-3")).data;
    assert.ok(one.rows.every((row) => row.outletId === "outlet-3"));

    const lekkiStock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    assert.equal((await lekkiStock.patch("/api/catalog", { categories: ["Only this"] })).status, 403);
    const catalog = (await admin.get("/api/catalog")).data;
    const updated = await admin.patch("/api/catalog", { dosageForms: [...catalog.dosageForms, "Lozenge"] });
    assert.equal(updated.status, 200);
    assert.ok(updated.data.dosageForms.includes("Lozenge"));
    const removeInUse = await admin.patch("/api/catalog", { categories: catalog.categories.filter((value) => value !== "Antibiotics") });
    assert.equal(removeInUse.status, 400, "a category used by items cannot be removed");
  });

  test("seeded stock was carried into the ledger as opening balances", async () => {
    const [row] = await server.query("SELECT COUNT(*) AS n FROM stock_ledger WHERE type = 'OPENING' AND user_id = 'system'");
    assert.ok(row.n > 0);
    await assertLedgerHealthy();
  });
});
