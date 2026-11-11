/*
  PharmaERP service worker (installable app shell).

  What it caches, and only this:
  - "static": versioned build assets (/_next/static, hashed file names), app icons and fonts. Cache-first.
  - "shell": the offline page and its images. Pre-cached on install.
  What it never caches: pages (they contain pharmacy data), /api/* responses, RSC/data requests, anything
  that is not a same-origin GET. Private offline business data will live in IndexedDB, never here.

  Updating: a new version installs alongside the old one, activates, and deletes caches of older versions.
  It never touches IndexedDB, so queued offline work survives updates.
*/
const VERSION = "2026-11-11.1";
const STATIC_CACHE = `pharmaerp-static-${VERSION}`;
const SHELL_CACHE = `pharmaerp-shell-${VERSION}`;
const SHELL = ["/offline.html", "/pwa/icon-192.png", "/pwa/icon-512.png", "/pharma-erp-logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
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
    const shell = await caches.open(SHELL_CACHE);
    return (await shell.match("/offline.html")) || new Response("PharmaERP is offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
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
});
