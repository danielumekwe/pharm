// Requirements D5–D7: configurable low-stock email notifications.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
let admin;
before(async () => {
  server = await startServer();
  admin = await signedIn(server.baseUrl, "admin@web365.ng");
  const configured = await admin.patch("/api/alerts/config", { action: "email", enabled: true, lowStockImmediate: true, criticalImmediate: true, notifyManagers: true, recipients: ["procurement@example.com"] });
  assert.equal(configured.status, 200, JSON.stringify(configured.data));
});
after(async () => {
  await server?.stop();
});

const ARTEMETHER_LEKKI = "prod-8"; // Artemether/Lumefantrine at Outlet 1 - Lekki, one in-date batch of 140 units

async function lowAlertsFor(productId) {
  return server.query("SELECT id, status, severity FROM inventory_alerts WHERE key = ? ORDER BY created_at", `LOW_STOCK:outlet-1:${productId}`);
}
async function emailsFor(alertId) {
  return server.query("SELECT recipient_email, status, payload, event FROM notification_deliveries WHERE channel = 'EMAIL' AND alert_id = ?", alertId);
}
/** Notifications are dispatched in the background after the API responds; wait until the alert records its notification. */
async function waitForNotified(alertId, timeout = 8000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const [row] = await server.query("SELECT history FROM inventory_alerts WHERE id = ?", alertId);
    if (row && JSON.parse(row.history).some((entry) => entry.action === "notified")) return;
    if (Date.now() > deadline) throw new Error(`alert ${alertId} was not notified in time`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForAlert(key, count = 1, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const rows = await server.query("SELECT id, status, severity FROM inventory_alerts WHERE key = ? ORDER BY created_at", key);
    if (rows.length >= count) return rows;
    if (Date.now() > deadline) throw new Error(`expected ${count} alert(s) for ${key}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function setItemThreshold(client, productId, minStock, maxStock = null) {
  const response = await client.patch("/api/alerts/thresholds", { productId, minStock, maxStock });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}

describe("Low-stock email notifications", () => {
  test("D5: an email is sent exactly when available stock reaches the threshold", async () => {
    const stockManager = await signedIn(server.baseUrl, "stock.lekki@web365.ng", "outlet-1");
    const above = await setItemThreshold(stockManager, ARTEMETHER_LEKKI, 139);
    assert.equal(above.available, 140);
    assert.equal(above.low, false);
    assert.equal((await lowAlertsFor(ARTEMETHER_LEKKI)).length, 0, "no alert while stock is above the minimum");

    const at = await setItemThreshold(stockManager, ARTEMETHER_LEKKI, 140, 300);
    assert.equal(at.low, true, "available == minimum counts as low");
    const [alert] = await waitForAlert(`LOW_STOCK:outlet-1:${ARTEMETHER_LEKKI}`);
    assert.ok(alert, "low-stock alert created");
    await waitForNotified(alert.id);

    const emails = await emailsFor(alert.id);
    const addresses = emails.map((email) => email.recipient_email).sort();
    assert.ok(addresses.includes("procurement@example.com"), "configured recipient emailed");
    assert.ok(addresses.includes("stock.lekki@web365.ng"), "outlet stock manager emailed");
    assert.ok(!addresses.includes("staff.ikeja@web365.ng"), "staff of other outlets are not emailed");
    assert.ok(emails.every((email) => email.status === "SENT" && email.event === "low"));

    const body = JSON.parse(emails[0].payload).text;
    for (const expected of ["Artemether/Lumefantrine 80/480", "Outlet 1 - Lekki", "Available stock (in-date, excluding quarantined/expired batches): 140", "Minimum stock threshold: 140", "Suggested reorder quantity: 160", "Detected:", "/alerts?tab=low&outlet=outlet-1"]) {
      assert.ok(body.includes(expected), `email contains "${expected}"`);
    }
  });

  test("D6: duplicate emails are prevented; a new email follows after replenishment and a new drop", async () => {
    const [alert] = await lowAlertsFor(ARTEMETHER_LEKKI);
    const before = (await emailsFor(alert.id)).length;
    assert.ok(before >= 2, "baseline emails recorded");
    for (let i = 0; i < 3; i += 1) assert.equal((await admin.get("/api/alerts")).status, 200);
    assert.equal((await admin.post("/api/alerts/jobs", { job: "scan" })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 800)); // give any (wrongful) resend time to land
    assert.equal((await emailsFor(alert.id)).length, before, "repeated scans do not resend");
    assert.equal((await lowAlertsFor(ARTEMETHER_LEKKI)).length, 1, "one alert for the unresolved condition");

    await setItemThreshold(admin, ARTEMETHER_LEKKI, 100); // 140 available > 100: replenished state
    assert.equal((await lowAlertsFor(ARTEMETHER_LEKKI))[0].status, "RESOLVED");
    await setItemThreshold(admin, ARTEMETHER_LEKKI, 150); // falls below again
    const alerts = await waitForAlert(`LOW_STOCK:outlet-1:${ARTEMETHER_LEKKI}`, 2);
    assert.equal(alerts.length, 2, "a new alert for the new occurrence");
    await waitForNotified(alerts[1].id);
    assert.ok((await emailsFor(alerts[1].id)).length >= 1, "and a new email");
  });

  test("D5: emails respect the master switch", async () => {
    const off = await admin.patch("/api/alerts/config", { action: "email", enabled: false });
    assert.equal(off.status, 200);
    assert.equal((await lowAlertsFor("prod-4")).length, 0, "Insulin @ Lekki starts above its minimum");
    await setItemThreshold(admin, "prod-4", 100); // Insulin at Lekki: 32 in-date units → new (critical) shortage
    const [alert] = await waitForAlert("LOW_STOCK:outlet-1:prod-4");
    assert.ok(alert, "alert still raised in-app");
    await waitForNotified(alert.id);
    assert.equal((await emailsFor(alert.id)).length, 0, "no email while disabled");
    assert.ok((await server.query("SELECT COUNT(*) AS n FROM notification_deliveries WHERE alert_id = ? AND channel = 'IN_APP'", alert.id))[0].n >= 1);
    await admin.patch("/api/alerts/config", { action: "email", enabled: true });
  });

  test("D7: thresholds can differ by product and outlet, with item overrides", async () => {
    const rule = async (scope, key, value) => {
      const response = await admin.patch("/api/alerts/config", { action: "rule", scope, key, value });
      assert.equal(response.status, 200, JSON.stringify(response.data));
    };
    // Items inherit unless they have an explicit item value.
    for (const productId of ["prod-1", "prod-11", "prod-2", "prod-3", "prod-5"]) {
      assert.equal((await admin.patch("/api/alerts/thresholds", { productId, inherit: true })).status, 200);
    }
    await rule("default", "default", 30);
    await rule("outlet", "outlet-2", 75);
    await rule("product", "Paracetamol 500mg", 500);
    await setItemThreshold(admin, "prod-9", 300); // Metformin @ Ikeja: explicit item threshold

    const rows = Object.fromEntries(
      (await server.query("SELECT id, min_stock, threshold_source FROM products WHERE id IN ('prod-1','prod-11','prod-2','prod-5','prod-3','prod-9')")).map((row) => [row.id, row]),
    );
    assert.deepEqual([rows["prod-1"].min_stock, rows["prod-1"].threshold_source], [500, "product"], "Paracetamol @ Lekki: product rule");
    assert.deepEqual([rows["prod-11"].min_stock, rows["prod-11"].threshold_source], [500, "product"], "Paracetamol @ warehouse: same product rule");
    assert.deepEqual([rows["prod-2"].min_stock, rows["prod-2"].threshold_source], [75, "outlet"], "Amoxicillin @ Ikeja: outlet rule");
    assert.deepEqual([rows["prod-5"].min_stock, rows["prod-5"].threshold_source], [75, "outlet"], "Hydrocortisone @ Ikeja: outlet rule");
    assert.deepEqual([rows["prod-3"].min_stock, rows["prod-3"].threshold_source], [30, "default"], "Cough Syrup @ VI: default");
    assert.deepEqual([rows["prod-9"].min_stock, rows["prod-9"].threshold_source], [300, "item"], "Metformin @ Ikeja: item override wins over the outlet rule");

    // Outlet-level staff cannot change the global rules.
    const stockManager = await signedIn(server.baseUrl, "store@web365.ng", "outlet-2");
    assert.equal((await stockManager.patch("/api/alerts/config", { action: "rule", scope: "default", key: "default", value: 1 })).status, 403);
    // …and cannot set item thresholds for an outlet they are not assigned to.
    assert.equal((await stockManager.patch("/api/alerts/thresholds", { productId: "prod-8", minStock: 1, maxStock: null })).status, 403);
  });
});
