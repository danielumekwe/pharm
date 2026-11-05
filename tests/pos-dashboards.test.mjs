// Role-based dashboards, the full-screen POS (discounts, split payments, held baskets, receipts),
// explicit stock transfers and concurrent sales.
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

const html = async (client, path) => {
  const response = await client.request("GET", path, undefined, { raw: true });
  return { status: response.status, location: response.headers.get("location"), body: response.status === 200 ? await response.text() : "" };
};
const days = (count) => new Date(Date.now() + count * 86_400_000).toISOString().slice(0, 10);

async function assertLedgerHealthy() {
  const verify = await admin.get("/api/stock-ledger?verify=1");
  assert.deepEqual(verify.data.mismatches, [], "cached balances match the ledger");
}

describe("Role-based dashboards", () => {
  test("each role lands on a dashboard built around its main job", async () => {
    const cases = [
      ["outlet@web365.ng", "outlet-1", "sales", ["NEW SALE", "Open the pharmacy POS terminal to start a new customer transaction.", "Sales by cashier", "Top-selling products", "Payment methods", "Daily sales summary"]],
      ["cashier@web365.ng", "outlet-1", "cashier", ["NEW SALE", "My transactions today", "Held transactions", "My recent sales"]],
      ["stock.lekki@web365.ng", "outlet-1", "inventory", ["RECEIVE STOCK", "Low-stock products", "Expiring batches", "Expired stock", "Stock transfers", "Pending receiving", "Adjustment requests"]],
      ["manager@web365.ng", "HQ", "manager", ["Consolidated sales today", "Sales by outlet", "Outlet performance", "Cashier performance", "Financial overview"]],
      ["admin@web365.ng", "HQ", "admin", ["Net sales", "Returns &amp; refunds", "Sales by outlet", "Staff activity", "Inventory by outlet"]],
      ["regulatory@web365.ng", "HQ", "regulatory", ["REGULATORY RECORDS", "Renewals due", "Upcoming renewal calendar", "Regulatory documents"]],
    ];
    for (const [email, outlet, kind, texts] of cases) {
      const client = await signedIn(server.baseUrl, email, outlet);
      const page = await html(client, "/dashboard");
      assert.equal(page.status, 200, email);
      assert.match(page.body, new RegExp(`data-dashboard="${kind}"`), `${email} sees the ${kind} dashboard`);
      for (const text of texts) assert.ok(page.body.includes(text), `${email}: "${text}"`);
    }
  });

  test("NEW SALE is the first element of the sales dashboards and opens the full-screen POS", async () => {
    for (const email of ["outlet@web365.ng", "cashier@web365.ng"]) {
      const client = await signedIn(server.baseUrl, email, "outlet-1");
      const { body } = await html(client, "/dashboard");
      const main = body.slice(body.indexOf("<main"));
      const primary = main.match(/<a[^>]*data-primary-action[^>]*>/)?.[0] ?? "";
      assert.match(primary, /href="\/pos"/, `${email}: NEW SALE links to /pos`);
      assert.ok(main.indexOf("NEW SALE") < main.indexOf("Today") || main.indexOf("NEW SALE") < main.indexOf("My transactions"), "NEW SALE comes before the statistics");
      const pos = await html(client, "/pos");
      assert.equal(pos.status, 200);
      assert.ok(pos.body.includes("Sales POS") && pos.body.includes("Scan barcode"), "dedicated POS terminal");
      assert.ok(!pos.body.includes('aria-label="Main navigation"'), "POS is outside the dashboard layout");
    }
    const stock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const stockDash = await html(stock, "/dashboard");
    assert.ok(!stockDash.body.includes("NEW SALE"), "stock managers do not get a NEW SALE action");
    const denied = await html(stock, "/pos");
    assert.equal(denied.status, 307, "roles without sales.create cannot open the POS");
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const sidebar = (await html(cashier, "/sales")).body;
    assert.ok(sidebar.includes('href="/pos"') && !sidebar.includes('href="/settings"') && !sidebar.includes('href="/users"'), "cashier sidebar hides administration");
  });
});

describe("Sales POS", () => {
  let product;
  test("setup: an item with packs and two batches", async () => {
    const created = await admin.post("/api/products", {
      name: "POS Test Ibuprofen 400mg",
      category: "Analgesics",
      dosageForm: "Tablet",
      outletId: "outlet-1",
      packaging: [{ name: "Pack", contains: 10 }, { name: "Strip", contains: 10 }, { name: "Tablet", contains: 1 }],
      pricing: { purchasePrice: 20, sellingPrice: 40 },
      barcodeMode: "manufacturer",
      barcodes: [{ code: "4006381333931", packagingIndex: 1 }],
      openingStock: [
        { batchNumber: "IBU-LATE", manufacturingDate: days(-30), expiryDate: days(600), packagingIndex: 0, quantity: 3 },
        { batchNumber: "IBU-SOON", manufacturingDate: days(-300), expiryDate: days(120), packagingIndex: 1, quantity: 5 },
      ],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    product = created.data;
    assert.equal(product.stock, 350);
  });

  test("the till catalogue shows FEFO batches, packaging prices and barcodes; outlet staff cannot load another outlet", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const catalog = (await cashier.get("/api/pos/catalog")).data;
    const item = catalog.find((row) => row.id === product.id);
    assert.deepEqual(item.batches.map((row) => row.batchNumber), ["IBU-SOON", "IBU-LATE"], "earliest expiry first");
    assert.deepEqual(item.packaging.map((row) => [row.name, row.price]), [["Pack", 4000], ["Strip", 400], ["Tablet", 40]]);
    assert.ok(item.packaging.find((row) => row.name === "Strip").barcodes.includes("4006381333931"));
    assert.equal((await cashier.get("/api/pos/catalog?outletId=outlet-2")).status, 403);
  });

  test("discount limits are enforced on the server and the authoriser is recorded", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const strip = product.packaging[1].id;
    const sale = (discount, extra = {}) => ({ outletId: "outlet-1", customerId: null, lines: [{ productId: product.id, packagingId: strip, quantity: 5, ...extra }], globalDiscount: discount, payments: [{ method: "Cash", amount: 5000 }] });
    const tooMuch = await cashier.post("/api/sales", sale({ type: "percent", value: 8 }));
    assert.equal(tooMuch.status, 403, "cashier limit is 5%");
    assert.match(tooMuch.data.error, /supervisor/);
    const ok = await cashier.post("/api/sales", sale({ type: "percent", value: 5 }));
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.discount, 100, "5% of 2,000");
    assert.equal(ok.data.discountAuthorisedBy, "Grace Udo");
    assert.deepEqual(ok.data.lines[0].allocations.map((row) => row.batchNumber), ["IBU-SOON"], "FEFO: the soon-expiring batch is sold first");

    const manager = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    const supervised = await manager.post("/api/sales", sale({ type: "amount", value: 300 }, { discount: { type: "percent", value: 5 } }));
    assert.equal(supervised.status, 201, "sales managers hold discount authority");
    assert.equal(supervised.data.discount, 400, "100 line + 300 basket");
    assert.equal(supervised.data.lines[0].total, 1600, "basket discount is shared into the line, so returns refund the right amount");
    const ceiling = await manager.post("/api/sales", sale({ type: "percent", value: 40 }));
    assert.equal(ceiling.status, 400, "nobody exceeds the supervisor ceiling");
  });

  test("split payment with cash change; underpayment and card over-tender are refused", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const strip = product.packaging[1].id;
    const lines = [{ productId: product.id, packagingId: strip, quantity: 10 }]; // 4,000 + 7.5% VAT = 4,300
    const short = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: null, lines, payments: [{ method: "Cash", amount: 4000 }] });
    assert.equal(short.status, 400);
    assert.match(short.data.error, /short/);
    const cardOver = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: null, lines, payments: [{ method: "Card", amount: 5000 }] });
    assert.equal(cardOver.status, 400);

    const split = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: null, lines, walkIn: { name: "Ada Obi", phone: "08030000000" }, payments: [{ method: "Card", amount: 2000, reference: "RRN123" }, { method: "Transfer", amount: 1000 }, { method: "Cash", amount: 2000 }] });
    assert.equal(split.status, 201, JSON.stringify(split.data));
    assert.equal(split.data.total, 4300);
    assert.equal(split.data.paymentMethod, "Split");
    assert.equal(split.data.change, 700);
    assert.equal(split.data.status, "Paid");
    assert.deepEqual(split.data.payments.map((row) => [row.method, row.amount]), [["Card", 2000], ["Transfer", 1000], ["Cash", 1300]], "cash is recorded net of change");
    assert.equal(split.data.customerName, "Ada Obi (walk-in)");
    // The soon-expiring batch was used up by the earlier sales, so this one draws from the later batch.
    assert.deepEqual(split.data.lines[0].allocations.map((row) => row.batchNumber), ["IBU-LATE"]);
    const payments = await server.query("SELECT method, amount FROM payments WHERE document_ref = ? ORDER BY method", split.data.number);
    assert.deepEqual(payments.map((row) => [row.method, row.amount]), [["Card", 2000], ["Cash", 1300], ["Transfer", 1000]], "one payment record per tender, persisted");
    const overview = (await admin.get("/api/sales-overview?outlet=outlet-1")).data;
    assert.ok(overview.totals.payments.pos >= 2000 && overview.totals.payments.transfer >= 1000, "split tenders feed the payment breakdown");

    const receipt = await cashier.get(`/api/sales/${split.data.id}/receipt`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.outlet.name.length > 0, true);
    for (let copy = 1; copy <= 2; copy += 1) {
      const pdf = await cashier.request("GET", `/api/sales/${split.data.id}/receipt?format=pdf&print=1`, undefined, { raw: true });
      assert.equal(pdf.headers.get("content-type"), "application/pdf");
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    }
    const [audit] = await server.query("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'sale.reprint' AND entity_id = ?", split.data.id);
    assert.equal(audit.n, 1, "the second print is an audited reprint");
  });

  test("held baskets are saved per cashier and removed when completed", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const held = await cashier.post("/api/pos/held", { kind: "HELD", outletId: "outlet-1", label: "Waiting for husband", cart: { lines: [{ productId: product.id, quantity: 3 }] } });
    assert.equal(held.status, 201, JSON.stringify(held.data));
    assert.match(held.data.reference, /^HLD-/);
    const manager = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    assert.ok((await manager.get("/api/pos/held?outletId=outlet-1")).data.some((row) => row.id === held.data.id), "supervisors see the outlet's held baskets");
    const staff = await signedIn(server.baseUrl, "relief@web365.ng", "outlet-1");
    assert.equal((await staff.get("/api/pos/held?outletId=outlet-1")).status, 403, "general staff have no POS access");
    assert.ok((await cashier.get("/api/pos/held?outletId=outlet-1")).data.some((row) => row.id === held.data.id));
    const done = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: null, lines: [{ productId: product.id, quantity: 3 }], payments: [{ method: "Cash", amount: 200 }], heldId: held.data.id });
    assert.equal(done.status, 201, JSON.stringify(done.data));
    assert.ok(!(await cashier.get("/api/pos/held?outletId=outlet-1")).data.some((row) => row.id === held.data.id), "completed basket is removed");
  });

  test("cashiers see only their own sales; supervisors see the outlet; voided sales never count", async () => {
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const own = (await cashier.get("/api/sales")).data;
    assert.ok(own.rows.length > 0 && own.rows.every((row) => row.cashier === "Grace Udo"));
    const manager = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    const outlet = (await manager.get("/api/sales")).data;
    assert.ok(new Set(outlet.rows.map((row) => row.cashier)).size > 1, "the sales manager sees the whole outlet");
    assert.ok(outlet.rows.every((row) => row.outletId === "outlet-1"));
    const voided = outlet.rows.filter((row) => row.status === "Voided");
    const completed = outlet.rows.filter((row) => row.status !== "Voided");
    assert.equal(outlet.totals.transactions, completed.length);
    assert.equal(outlet.totals.voided, voided.length);
    assert.ok(voided.every((row) => row.net === 0));
    const page = await html(cashier, "/sales");
    assert.ok(page.body.includes("My sales history"));
  });

  test("concurrent sales cannot oversell (requests are serialised in database transactions)", async () => {
    const scarce = await admin.post("/api/products", {
      name: "Scarce Insulin Pen",
      category: "Antidiabetics",
      outletId: "outlet-1",
      packaging: [{ name: "Pen", contains: 1 }],
      pricing: { purchasePrice: 5000, sellingPrice: 8000 },
      barcodeMode: "none",
      openingStock: [{ batchNumber: "INS-1", manufacturingDate: days(-10), expiryDate: days(300), quantity: 5 }],
    });
    assert.equal(scarce.status, 201, JSON.stringify(scarce.data));
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const attempts = await Promise.all(
      Array.from({ length: 9 }, () => cashier.post("/api/sales", { outletId: "outlet-1", customerId: null, lines: [{ productId: scarce.data.id, quantity: 1 }], payments: [{ method: "Cash", amount: 9000 }] })),
    );
    assert.equal(attempts.filter((row) => row.status === 201).length, 5, "exactly the 5 units in stock were sold");
    assert.ok(attempts.filter((row) => row.status !== 201).every((row) => row.status === 400));
    const [batch] = await server.query("SELECT available_quantity FROM batches WHERE product_id = ?", scarce.data.id);
    assert.equal(batch.available_quantity, 0);
    await assertLedgerHealthy();
  });
});

describe("Stock transfers", () => {
  test("request → approval (maker-checker) → dispatch at source → receipt with discrepancy at destination", async () => {
    const lekkiStock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const ikejaStock = await signedIn(server.baseUrl, "store@web365.ng", "outlet-2");
    const item = (await lekkiStock.get("/api/products")).data.find((row) => row.name === "POS Test Ibuprofen 400mg");
    const sourceBefore = item.stock;

    const created = await lekkiStock.post("/api/transfers", { fromOutletId: "outlet-1", toOutletId: "outlet-2", lines: [{ productId: item.id, quantity: 40 }] });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const id = created.data.id;
    assert.equal(created.data.status, "Pending approval");
    assert.equal((await ikejaStock.post("/api/transfers", { fromOutletId: "outlet-1", toOutletId: "outlet-2", lines: [{ productId: item.id, quantity: 1 }] })).status, 403, "only the source outlet can request");
    assert.equal((await lekkiStock.patch(`/api/transfers/${id}`, { action: "approve" })).status, 403, "requester cannot approve");
    assert.equal((await lekkiStock.patch(`/api/transfers/${id}`, { action: "dispatch" })).status, 400, "cannot dispatch before approval");
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    assert.equal((await manager.patch(`/api/transfers/${id}`, { action: "approve" })).status, 200);
    assert.equal((await ikejaStock.patch(`/api/transfers/${id}`, { action: "dispatch" })).status, 403, "destination cannot dispatch");
    const dispatched = await lekkiStock.patch(`/api/transfers/${id}`, { action: "dispatch" });
    assert.equal(dispatched.status, 200, JSON.stringify(dispatched.data));
    assert.equal(dispatched.data.status, "Dispatched");
    const afterDispatch = (await lekkiStock.get(`/api/products/${item.id}`)).data.summary.available;
    assert.equal(afterDispatch, sourceBefore - 40, "stock leaves the source on dispatch");

    const batches = dispatched.data.lines[0].dispatched;
    assert.equal((await lekkiStock.patch(`/api/transfers/${id}`, { action: "receive", lines: [] })).status, 403, "the source cannot confirm receipt");
    const noNote = await ikejaStock.patch(`/api/transfers/${id}`, { action: "receive", final: true, lines: batches.map((row) => ({ productId: item.id, batchNumber: row.batchNumber, quantity: row.quantity - 2 })) });
    assert.equal(noNote.status, 400, "a shortfall needs an explanation");
    const received = await ikejaStock.patch(`/api/transfers/${id}`, { action: "receive", final: true, note: "2 tablets crushed in transit", lines: batches.map((row, index) => ({ productId: item.id, batchNumber: row.batchNumber, quantity: index === 0 ? row.quantity - 2 : row.quantity })) });
    assert.equal(received.status, 200, JSON.stringify(received.data));
    assert.equal(received.data.status, "Received");
    assert.equal(received.data.discrepancies[0].missing, 2);
    const destination = (await ikejaStock.get("/api/products")).data.find((row) => row.name === item.name);
    assert.equal(destination.stock, 38, "destination gets only what it confirmed");
    const [row] = await server.query("SELECT status, discrepancies FROM stock_transfers WHERE id = ?", id);
    assert.equal(row.status, "Received");
    assert.match(row.discrepancies, /crushed/);
    await assertLedgerHealthy();
  });
});

describe("Role privileges", () => {
  test("each role is limited to its responsibilities (server-enforced)", async () => {
    const products = (await admin.get("/api/products")).data;
    const lekkiItem = products.find((row) => row.outletId === "outlet-1");

    // Stock manager: maintains items and receives stock, but cannot change prices or see the staff list.
    const stock = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const price = await stock.patch(`/api/products/${lekkiItem.id}`, { sellingPrice: lekkiItem.sellingPrice + 100 });
    assert.equal(price.status, 403, "stock managers cannot change prices");
    const levels = await stock.patch(`/api/products/${lekkiItem.id}`, { pricing: { sellingPrice: lekkiItem.sellingPrice + 100 } });
    assert.equal(levels.status, 403);
    assert.equal((await stock.patch(`/api/products/${lekkiItem.id}`, { minStock: 15 })).status, 200, "reorder levels are still theirs");
    assert.equal((await stock.request("GET", "/users", undefined, { raw: true })).status, 307, "no staff directory");

    // Regulatory officer: no stock approvals.
    const manager = await signedIn(server.baseUrl, "manager@web365.ng");
    const request = await manager.post("/api/stock-movements", { type: "Adjustment", productId: lekkiItem.id, quantity: 1, reason: "Count variance" });
    assert.equal(request.status, 201, JSON.stringify(request.data));
    const regulatory = await signedIn(server.baseUrl, "regulatory@web365.ng");
    assert.equal((await regulatory.patch(`/api/inventory/${request.data.id}`, { status: "Approved" })).status, 403, "regulatory officers cannot approve stock movements");

    // Sales manager: no finance or staff-account administration.
    const sales = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    assert.equal((await sales.post("/api/expenses", { category: "Utilities", description: "Diesel", vendor: "X", outletId: "outlet-1", amount: 1000, date: new Date().toISOString().slice(0, 10) })).status, 403);
    assert.equal((await sales.request("GET", "/finance", undefined, { raw: true })).status, 307, "no finance pages");
    assert.equal((await sales.post("/api/users", { name: "New Cashier", email: "x@example.com", role: "CASHIER", outletIds: ["outlet-1"] })).status, 403);

    // Sales roles see how much stock is left, read-only, and nothing else of inventory.
    for (const [email, outlet] of [["outlet@web365.ng", "outlet-1"], ["cashier@web365.ng", "outlet-1"]]) {
      const client = await signedIn(server.baseUrl, email, outlet);
      for (const path of ["/stock", "/products", "/products/new", "/inventory", "/transfers", "/alerts", "/purchase", "/finance", "/users", "/outlets"]) {
        assert.equal((await client.request("GET", path, undefined, { raw: true })).status, 307, `${email} cannot open ${path}`);
      }
      assert.equal((await client.get("/api/products")).status, 403);
      assert.equal((await client.get("/api/stock-ledger")).status, 403);
      assert.equal((await client.patch(`/api/products/${lekkiItem.id}`, { minStock: 1 })).status, 403);
      assert.equal((await client.post("/api/stock-movements", { type: "Adjustment", productId: lekkiItem.id, quantity: 1, reason: "test" })).status, 403);
      const levels = await client.request("GET", "/stock-levels", undefined, { raw: true });
      assert.equal(levels.status, 200);
      const page = await levels.text();
      assert.ok(page.includes("Quantity left") && page.includes(lekkiItem.name));
      const menu = page.slice(page.indexOf('aria-label="Main navigation"'), page.indexOf("</nav>", page.indexOf('aria-label="Main navigation"')));
      const links = [...menu.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
      const allowed = ["/dashboard", "/pos", "/sales", "/stock-levels", "/sales-overview", "/contacts", "/notifications"];
      assert.deepEqual(links.filter((href) => !allowed.includes(href)), [], `${email} menu shows only sales items: ${links.join(", ")}`);
    }
    const contacts = await (await sales.request("GET", "/contacts", undefined, { raw: true })).text();
    assert.ok(!contacts.includes("Add supplier") && !contacts.includes("Payables"), "sales roles do not see suppliers");
    assert.equal((await sales.post("/api/contacts", { kind: "supplier", name: "Some Supplier", contactPerson: "", phone: "", email: "", pcnLicense: "", paymentTermsDays: 30, categories: "" })).status, 403);

    // General staff and the pharmacy manager do not sell at the till.
    const staff = await signedIn(server.baseUrl, "relief@web365.ng", "outlet-1");
    const sale = { outletId: "outlet-1", customerId: null, lines: [{ productId: lekkiItem.id, quantity: 1 }], payments: [{ method: "Cash", amount: 100000 }] };
    assert.equal((await staff.post("/api/sales", sale)).status, 403);
    assert.equal((await staff.request("GET", "/pos", undefined, { raw: true })).status, 307);
    assert.equal((await manager.post("/api/sales", sale)).status, 403);
    assert.equal((await manager.patch("/api/alerts/config", { enabled: false })).status, 403, "alert email rules are Super Admin only");

    // Managers can still change prices.
    assert.equal((await manager.patch(`/api/products/${lekkiItem.id}`, { sellingPrice: lekkiItem.sellingPrice + 50 })).status, 200);
  });
});
