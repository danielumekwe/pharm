// Settings branding (site title + logo) and the dashboard's live sales feed.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { Client, signedIn } from "./helpers/client.mjs";
import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

// Smallest valid PNG (1×1 transparent pixel).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function uploadLogo(client, bytes, type) {
  const form = new FormData();
  form.set("file", new File([bytes], "logo", { type }));
  const response = await fetch(`${server.baseUrl}/api/settings/logo`, { method: "POST", headers: { cookie: client.cookieHeader() }, body: form });
  return { status: response.status, data: await response.json() };
}

describe("Branding", () => {
  test("site title defaults to Pharmacy ERP; signed-in pages follow the pharmacy's business name", async () => {
    const page = async () => (await fetch(`${server.baseUrl}/login`)).text();
    assert.match(await page(), /<title>Pharmacy ERP<\/title>/);
    assert.doesNotMatch(await page(), /PharmERP/i, "old product name is gone (demo emails @web365.ng are login IDs)");

    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    const saved = await admin.post("/api/settings", { action: "update", businessName: "Greenleaf Pharmacy" });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const html = await admin.request("GET", "/dashboard", undefined, { raw: true }).then((response) => response.text());
    assert.match(html, /<title>Greenleaf Pharmacy<\/title>/, "the pharmacy's pages use its name");
    // The public sign-in page belongs to no pharmacy: it keeps the platform name.
    assert.match(await page(), /<title>Pharmacy ERP<\/title>/);
    assert.doesNotMatch(await page(), /Greenleaf Pharmacy/);

    await admin.post("/api/settings", { action: "update", businessName: "Pharmacy ERP" });
  });

  test("Super Admin can upload, serve and remove a logo; others cannot", async () => {
    const admin = await signedIn(server.baseUrl, "admin@web365.ng");
    assert.equal((await fetch(`${server.baseUrl}/api/branding/logo`)).status, 404, "no logo until one is uploaded");

    const fake = await uploadLogo(admin, Buffer.from("<svg onload=alert(1)>"), "image/png");
    assert.equal(fake.status, 400, "content must match the declared image type");

    const manager = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    assert.equal((await uploadLogo(manager, PNG, "image/png")).status, 403);

    const uploaded = await uploadLogo(admin, PNG, "image/png");
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
    const { logoFile } = uploaded.data;
    assert.match(logoFile, /^brand-logo-[0-9a-f]+\.png$/);

    // Served to the pharmacy's own users, byte-for-byte identical, and never cached by shared caches.
    const logo = await admin.request("GET", `/api/branding/logo?v=${logoFile}`, undefined, { raw: true });
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.match(logo.headers.get("cache-control"), /private.*immutable/);
    assert.deepEqual(Buffer.from(await logo.arrayBuffer()), PNG);
    const dashboard = await admin.request("GET", "/dashboard", undefined, { raw: true }).then((response) => response.text());
    assert.match(dashboard, new RegExp(`/api/branding/logo\\?v=${logoFile}`), "the app chrome links the logo");
    // The public sign-in page and anonymous requests get the platform logo, not a pharmacy's.
    assert.equal((await fetch(`${server.baseUrl}/api/branding/logo?v=${logoFile}`)).status, 404);
    assert.doesNotMatch(await (await fetch(`${server.baseUrl}/login`)).text(), new RegExp(logoFile));
    assert.doesNotMatch(await (await fetch(`${server.baseUrl}/`)).text(), new RegExp(logoFile));

    const removed = await admin.delete("/api/settings/logo");
    assert.equal(removed.status, 200);
    assert.equal(removed.data.logoFile, null);
    assert.equal((await admin.request("GET", "/api/branding/logo", undefined, { raw: true })).status, 404);
  });
});

describe("Live sales feed", () => {
  test("a new sale appears in the feed for its outlet's sales reps, not for other outlets", async () => {
    const lekkiRep = await signedIn(server.baseUrl, "outlet@web365.ng", "outlet-1");
    const ikejaRep = await signedIn(server.baseUrl, "sales.ikeja@web365.ng", "outlet-2");
    const before = (await lekkiRep.get("/api/sales/feed")).data;

    const cashier = await signedIn(server.baseUrl, "cashier@web365.ng", "outlet-1");
    const sale = await cashier.post("/api/sales", { outletId: "outlet-1", customerId: "cus-1", paymentMethod: "Cash", lines: [{ productId: "prod-8", quantity: 1 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.data));

    const feed = await lekkiRep.get("/api/sales/feed");
    assert.equal(feed.status, 200);
    assert.equal(feed.data.sales[0].id, sale.data.id, "newest sale is first");
    assert.equal(feed.data.sales[0].cashier, "Grace Udo");
    assert.equal(feed.data.today.count, before.today.count + 1);

    const other = await ikejaRep.get("/api/sales/feed");
    assert.equal(other.status, 200);
    assert.ok(!other.data.sales.some((row) => row.id === sale.data.id), "Ikeja does not see a Lekki sale");
    assert.ok(other.data.sales.every((row) => row.outlet !== feed.data.sales[0].outlet), "only Ikeja sales");

    const stock = await signedIn(server.baseUrl, "store@web365.ng", "outlet-2");
    assert.equal((await stock.get("/api/sales/feed")).status, 403, "roles without sales access are refused");
    assert.equal((await new Client(server.baseUrl).get("/api/sales/feed")).status, 401);
  });
});
