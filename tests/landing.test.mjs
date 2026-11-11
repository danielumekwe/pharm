// The public landing page at "/": live pricing from the plan catalogue, working links, SEO tags,
// and no tenant data. Pharmacy sign-in moved to /login.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { startServer } from "./helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

const home = async () => (await fetch(`${server.baseUrl}/`)).text();
const naira = (amount) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

describe("Landing page", () => {
  test("is the public home page, with SEO tags, and links to sign-in and registration", async () => {
    const response = await fetch(`${server.baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>PharmaERP \| Smart Pharmacy Management Software<\/title>/);
    assert.match(html, /<meta name="description" content="Manage pharmacy sales, inventory/);
    assert.match(html, /<meta property="og:title"/);
    assert.match(html, /<meta name="twitter:title"/);
    assert.match(html, /<script type="application\/ld\+json">/);
    assert.match(html, /<h1[^>]*>Run Your Pharmacy Smarter\./);
    assert.match(html, /href="\/login"/);
    assert.match(html, /href="\/register"/);
    for (const id of ["features", "how-it-works", "pricing", "about", "contact"]) {
      assert.match(html, new RegExp(`id="${id}"`), id);
      assert.match(html, new RegExp(`href="#${id}"`), `link to ${id}`);
    }
    assert.match(html, /Developed by Web365 Nigeria/);
    assert.match(html, /hero-phone-stock-alerts/, "shows real product screenshots");
  });

  test("shows the public plans with their configured prices, and follows Control Centre changes", async () => {
    const plans = await server.query("SELECT id, name, monthly_price FROM plans WHERE is_active AND is_public ORDER BY sort_order");
    const hidden = await server.query("SELECT name FROM plans WHERE NOT (is_active AND is_public)");
    assert.ok(plans.length > 0);
    let html = await home();
    for (const plan of plans) {
      assert.match(html, new RegExp(`data-plan="${plan.name}"`), plan.name);
      if (plan.monthly_price !== null) assert.ok(html.includes(naira(Number(plan.monthly_price))), `${plan.name} price`);
    }
    for (const plan of hidden) assert.doesNotMatch(html, new RegExp(`data-plan="${plan.name}"`), `hidden plan ${plan.name}`);

    const [first] = plans;
    await server.query("UPDATE plans SET monthly_price = 12345 WHERE id = ?", first.id);
    try {
      html = await home();
      assert.ok(html.includes(naira(12345)), "the new price shows at once");
    } finally {
      await server.query("UPDATE plans SET monthly_price = ? WHERE id = ?", first.monthly_price, first.id);
    }
  });

  test("offers a free trial only while trials are switched on", async () => {
    assert.match(await home(), /Start Free Trial/);
    const [setting] = await server.query("SELECT value FROM platform_settings WHERE key = 'system.config'");
    const current = setting?.value ?? null;
    const off = { ...(current ?? {}), trialsEnabled: false };
    await server.query(
      `INSERT INTO platform_settings (key, value) VALUES ('system.config', ?::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      JSON.stringify(off),
    );
    try {
      const html = await home();
      assert.doesNotMatch(html, /Start Free Trial|free trial/i);
      assert.match(html, /Get Started/);
    } finally {
      if (current) await server.query("UPDATE platform_settings SET value = ?::jsonb WHERE key = 'system.config'", JSON.stringify(current));
      else await server.query("DELETE FROM platform_settings WHERE key = 'system.config'");
    }
  });

  test("names no pharmacy, outlet or account", async () => {
    const html = await home();
    for (const marker of ["Outlet 1 - Lekki", "Web365 Demo Pharmacy", "admin@web365.ng", "Pharmacy B"]) assert.ok(!html.includes(marker), `landing page shows ${marker}`);
  });

  test("signed-out visitors to the app are sent to /login", async () => {
    const response = await fetch(`${server.baseUrl}/dashboard`, { redirect: "manual" });
    assert.ok([302, 307].includes(response.status));
    assert.match(response.headers.get("location") ?? "", /\/login/);
  });
});
