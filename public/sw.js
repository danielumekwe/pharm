/*
  PharmaERP service worker (installable app shell).

  What it caches, and only this:
  - "static": versioned build assets (/_next/static, hashed file names), app icons and fonts. Cache-first.
  - "shell": the offline page and its images, and the offline app (/app-offline). The offline app is
    fetched WITHOUT cookies, so the stored HTML belongs to nobody; its data comes from IndexedDB after a
    PIN unlock. Pre-cached on install and refreshed by the app while online.
  What it never caches: pages (they contain pharmacy data), /api/* responses, RSC/data requests, anything
  that is not a same-origin GET. Private offline business data will live in IndexedDB, never here.

  Updating: a new version installs alongside the old one, activates, and deletes caches of older versions.
  It never touches IndexedDB, so queued offline work survives updates.
*/
const VERSION = "2026-11-12.3";
const STATIC_CACHE = `pharmaerp-static-${VERSION}`;
const SHELL_CACHE = `pharmaerp-shell-${VERSION}`;
const SHELL = ["/offline.html", "/pwa/icon-192.png", "/pwa/icon-512.png", "/pharma-erp-logo.png"];

const APP_SHELL = "/app-offline";

/** Stores the offline app page (anonymous) and every build file it loads. */
async function cacheAppShell() {
  const response = await fetch(new Request(APP_SHELL, { credentials: "omit", cache: "reload" }));
  if (!response.ok || response.redirected) return false;
  const html = await response.clone().text();
  // Script and style tags, and chunk paths inside the inline page data.
  const assets = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s)]+/g)].map((match) => match[0].replace(/&amp;/g, "&")))];
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.all(assets.map((url) => staticCache.match(url).then((hit) => hit || fetch(url).then((asset) => asset.ok && staticCache.put(url, asset)))));
  await (await caches.open(SHELL_CACHE)).put(APP_SHELL, response);
  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => cacheAppShell().catch(() => false))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("pharmaerp-") && key !== STATIC_CACHE && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa/") || /\.(?:woff2?|ttf|otf)$/.test(url.pathname);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Only complete, public, same-origin responses are stored.
  if (response.ok && response.type === "basic" && !/no-store|private/.test(response.headers.get("Cache-Control") || "")) cache.put(request, response.clone());
  return response;
}

async function networkThenOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    // No connection: open the offline app (PIN unlock, offline till), or the plain offline page.
    const shell = await caches.open(SHELL_CACHE);
    return (await shell.match(APP_SHELL)) || (await shell.match("/offline.html")) || new Response("PharmaERP is offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || request.headers.get("RSC") || url.searchParams.has("_rsc")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkThenOfflinePage(request));
    return;
  }
  if (isStaticAsset(url) || SHELL.includes(url.pathname)) event.respondWith(cacheFirst(request).catch(() => caches.match(request)));
});

self.addEventListener("message", (event) => {
  if (event.data === "pharmaerp:version") event.source?.postMessage({ type: "pharmaerp:version", version: VERSION });
  // After a deploy the app asks for a fresh copy of the offline app.
  if (event.data === "pharmaerp:refresh-shell") event.waitUntil(cacheAppShell().catch(() => false));
});

// Background Sync (Chrome/Edge/Android): wake open PharmaERP windows to upload. The upload itself runs in the
// page, which holds the device key; browsers without Background Sync upload on the app's own triggers.
self.addEventListener("sync", (event) => {
  if (event.tag !== "pharmaerp-sync") return;
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((clients) => clients.forEach((client) => client.postMessage("pharmaerp:sync"))));
});
