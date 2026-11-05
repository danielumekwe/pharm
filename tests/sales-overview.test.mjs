// Requirements D8–D10: consolidated daily sales overview.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

const money = (value) => Math.round(value * 100) / 100;

describe("Daily sales overview", () => {
  test("D8: Super Admin sees consolidated sales across all three outlets, matching the database", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const { status, data } = await admin.get("/api/sales-overview?from=2025-01-01");
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.meta.scope, "consolidated");
    assert.deepEqual(data.byOutlet.map((row) => row.id).sort(), ["outlet-1", "outlet-2", "outlet-3"]);
    assert.ok(data.byOutlet.every((row) => row.transactions > 0), "seeded history covers every outlet");

    // Consolidated totals are the sum of the outlet totals (no double counting)…
    const sum = (key) => money(data.byOutlet.reduce((total, row) => total + row[key], 0));
    for (const key of ["transactions", "gross", "discounts", "returns", "net"]) assert.equal(money(data.totals[key]), sum(key), key);
    // …and match an independent query of the sales table.
    const [db] = await server.query("SELECT COUNT(*) AS n, SUM(subtotal) AS gross FROM sales WHERE status != 'Voided' AND (date::timestamp + INTERVAL '1 hour')::date BETWEEN DATE '2025-01-01' AND ?::date", data.meta.to);
    assert.equal(data.totals.transactions, db.n);
    assert.equal(money(data.totals.gross), money(db.gross));
    const [voided] = await server.query("SELECT COUNT(*) AS n FROM sales WHERE status = 'Voided'");
    assert.equal(data.totals.voided, voided.n, "voided invoices are reported separately");

    // Individual outlet view.
    const single = await admin.get("/api/sales-overview?from=2025-01-01&outlet=outlet-3");
    assert.equal(single.status, 200);
    assert.deepEqual(single.data.byOutlet.map((row) => row.id), ["outlet-3"]);
    assert.equal(single.data.totals.transactions, data.byOutlet.find((row) => row.id === "outlet-3").transactions);

    // Trends and exports.
    for (const trend of ["daily", "weekly", "monthly", "yearly"]) {
      const response = await admin.get(`/api/sales-overview?trend=${trend}`);
      assert.equal(response.status, 200);
      assert.ok(response.data.trend.length >= 1, `${trend} trend has data`);
    }
    const pdf = await admin.request("GET", "/api/sales-overview?format=pdf", undefined, { raw: true });
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    const inventoryPdf = await admin.request("GET", "/api/inventory-reports?kind=low-stock&format=pdf&outlet=all", undefined, { raw: true });
    assert.equal(inventoryPdf.headers.get("content-type"), "application/pdf", "inventory report PDF");
    assert.equal(Buffer.from(await inventoryPdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    const xlsx = await admin.request("GET", "/api/sales-overview?format=xlsx", undefined, { raw: true });
    assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
    assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), "PK");
  });

  test("D9: outlet managers and cashiers cannot see unauthorised outlet reports", async () => {
    const salesManager = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1"); // Sales Manager, Lekki
    const own = await salesManager.get("/api/sales-overview?from=2025-01-01");
    assert.equal(own.status, 200);
    assert.deepEqual(own.data.meta.outletIds, ["outlet-1"]);
    assert.equal((await salesManager.get("/api/sales-overview?outlet=outlet-2")).status, 403);
    assert.equal((await salesManager.get("/api/sales-overview?outlet=all")).status, 200, "\"all\" means all of their own outlets");

    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1"); // Staff, Lekki
    await cashier.post("/api/sales", { outletId: "outlet-1", customerId: "cus-1", paymentMethod: "Cash", lines: [{ productId: "prod-8", quantity: 1 }] });
    const mine = await cashier.get("/api/sales-overview");
    assert.equal(mine.status, 200);
    assert.equal(mine.data.meta.scope, "own");
    assert.ok(mine.data.byCashier.length >= 1);
    assert.ok(mine.data.byCashier.every((row) => row.cashier === "Grace Udo"), "only the cashier's own sales");
    assert.equal((await cashier.get("/api/sales-overview?outlet=outlet-3")).status, 403);

    const stockManager = await signedIn(server.baseUrl, "store@web365.ng", "outlet-2"); // no sales permissions
    assert.equal((await stockManager.get("/api/sales-overview")).status, 403);
    assert.equal((await stockManager.request("GET", "/sales-overview", undefined, { raw: true })).status, 307, "page redirects without access");
  });

  test("D10: discounts, voids and refunds are reflected correctly in net sales", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const manager = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    const before = (await admin.get("/api/sales-overview?outlet=outlet-1")).data.totals;
    // Sale A gives a 9% discount; allow cashiers up to 10% for this scenario (the default limit is 5%).
    assert.equal((await admin.patch("/api/settings/pos", { cashierMaxDiscountPct: 10, approverMaxDiscountPct: 25, salesTargets: {} })).status, 200);

    // Sale A: 2 × ₦2,200 with a ₦400 line discount (cash). Sale B: 1 × ₦2,200 by POS, then voided.
    const saleA = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: "cus-1", paymentMethod: "Cash", lines: [{ productId: "prod-8", quantity: 2, discount: 400 }] });
    assert.equal(saleA.status, 201, JSON.stringify(saleA.data));
    const saleB = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: "cus-1", paymentMethod: "Card", lines: [{ productId: "prod-8", quantity: 1 }] });
    assert.equal(saleB.status, 201);
    assert.equal((await manager.patch(`/api/sales/${saleB.data.id}`, { action: "void", reason: "Customer changed mind" })).status, 200);

    // Return 1 of the 2 units from sale A, refunded in cash. Over-returning is refused.
    assert.equal((await manager.post(`/api/sales/${saleA.data.id}/returns`, { lines: [{ productId: "prod-8", quantity: 3 }], reason: "Too many", refundMethod: "Cash", restock: false })).status, 400);
    const ret = await manager.post(`/api/sales/${saleA.data.id}/returns`, { lines: [{ productId: "prod-8", quantity: 1 }], reason: "Unopened, not needed", refundMethod: "Cash", restock: true });
    assert.equal(ret.status, 201, JSON.stringify(ret.data));
    assert.equal(ret.data.net, 2000, "refund is per unit after discount: (4,400 − 400) / 2");
    assert.equal(ret.data.vat, 150);
    assert.equal(ret.data.total, 2150);
    assert.equal((await cashier.post(`/api/sales/${saleA.data.id}/returns`, { lines: [{ productId: "prod-8", quantity: 1 }], reason: "x y z", refundMethod: "Cash", restock: false })).status, 403, "staff cannot process returns");

    const after = (await admin.get("/api/sales-overview?outlet=outlet-1")).data.totals;
    assert.equal(after.transactions - before.transactions, 1, "voided sale B is not a completed transaction");
    assert.equal(money(after.gross - before.gross), 4400, "gross is before discounts");
    assert.equal(money(after.discounts - before.discounts), 400);
    assert.equal(money(after.returns - before.returns), 2000);
    assert.equal(money(after.net - before.net), 2000, "net = 4,400 − 400 − 2,000");
    assert.equal(after.voided - before.voided, 1);
    assert.equal(money(after.voidedValue - before.voidedValue), saleB.data.total);
    assert.equal(money(after.payments.cash - before.payments.cash), saleA.data.total);
    assert.equal(money(after.payments.refundCash - before.payments.refundCash), 2150);
    assert.equal(money(after.payments.netCash - before.payments.netCash), money(saleA.data.total - 2150));
    assert.equal(money(after.payments.pos - before.payments.pos), 0, "voided POS sale contributes nothing");

    // Persisted as real rows.
    const [row] = await server.query("SELECT r.total, r.refunded_amount, COUNT(l.position) AS lines FROM sale_returns r JOIN sale_return_lines l ON l.sale_return_id = r.id WHERE r.id = ? GROUP BY r.id", ret.data.id);
    assert.deepEqual([row.total, row.refunded_amount, row.lines], [2150, 2150, 1]);
  });
});
