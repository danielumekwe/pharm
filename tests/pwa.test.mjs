// Installable app (PWA): manifest, icons, service worker rules, offline page, reachability check, install page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const get = (path) => fetch(`${server.baseUrl}${path}`, { redirect: "manual" });

describe("Installable app", () => {
  test("the manifest makes PharmaERP installable as a standalone app", async () => {
    const response = await get("/manifest.webmanifest");
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.equal(manifest.name, "PharmaERP");
    assert.equal(manifest.short_name, "PharmaERP");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.scope, "/");
    assert.match(manifest.start_url, /^\/dashboard/);
    assert.equal(manifest.theme_color, "#188030");
    assert.equal(manifest.background_color, "#ffffff");
    for (const size of ["192x192", "512x512"]) {
      assert.ok(manifest.icons.some((icon) => icon.sizes === size && icon.purpose === "any"), `${size} icon`);
      assert.ok(manifest.icons.some((icon) => icon.sizes === size && icon.purpose === "maskable"), `${size} maskable icon`);
    }
    for (const icon of manifest.icons) {
      const file = await get(icon.src);
      assert.equal(file.status, 200, icon.src);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const view = new DataView(bytes.buffer);
      assert.equal(`${view.getUint32(16)}x${view.getUint32(20)}`, icon.sizes, `${icon.src} has its declared size`);
    }
  });

  test("pages link the manifest, theme colour and iOS home-screen settings", async () => {
    const html = await (await get("/login")).text();
    assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest"/);
    assert.match(html, /<meta name="theme-color" content="#188030"/);
    assert.match(html, /apple-mobile-web-app-capable|mobile-web-app-capable/);
    assert.match(html, /apple-touch-icon/);
  });

  test("the service worker is served fresh and never caches pages or API responses", async () => {
    const response = await get("/sw.js");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-cache/);
    assert.equal(response.headers.get("service-worker-allowed"), "/");
    const source = await response.text();
    assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)[^\n]*return;/, "API requests bypass the worker");
    assert.match(source, /request\.method !== "GET"\) return/, "only GET requests are handled");
    assert.match(source, /networkThenOfflinePage/, "pages always come from the network");
    assert.doesNotMatch(source, /indexedDB/, "the worker does not touch the offline database");
  });

  test("the offline page is self-contained and reopens the app when the server answers", async () => {
    const response = await get("/offline.html");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /You're offline/);
    assert.match(html, /fetch\("\/api\/health"/);
    assert.doesNotMatch(html, /<script[^>]+src=/, "no external scripts");
  });

  test("the reachability check answers without a session and is never cached", async () => {
    const response = await get("/api/health");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).ok, true);
  });

  test("the install page is available to every signed-in user and shows instructions for each platform", async () => {
    const anonymous = await new Client(server.baseUrl).request("GET", "/install", undefined, { raw: true });
    assert.equal(anonymous.status, 307);
    for (const [email, outlet] of [["admin@web365.ng", "HQ"], ["cashier@web365.ng", "outlet-1"]]) {
      const client = await signedIn(server.baseUrl, email, outlet);
      const response = await client.request("GET", "/install", undefined, { raw: true });
      assert.equal(response.status, 200, email);
      const html = await response.text();
      for (const text of ["Install PharmaERP", "Windows", "macOS", "Android", "iPhone and iPad", "Add to Home Screen"]) assert.ok(html.includes(text), `${email}: ${text}`);
      assert.ok(!html.includes("data-install"), "no install button until the browser offers one");
    }
  });

  test("the generated icons are committed", () => {
    for (const name of ["icon-192.png", "icon-512.png", "maskable-192.png", "maskable-512.png", "apple-touch-icon.png"]) assert.ok(readFileSync(new URL(`../public/pwa/${name}`, import.meta.url)).length > 1000, name);
  });
});
