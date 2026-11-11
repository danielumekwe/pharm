import type { MetadataRoute } from "next";

/** Installable app (PWA). Served at /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PharmaERP",
    short_name: "PharmaERP",
    description: "Pharmacy management: point of sale, inventory, batches and expiry, outlets and reports.",
    start_url: "/dashboard?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#188030",
    categories: ["business", "medical", "productivity"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New sale", short_name: "POS", url: "/pos", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Stock levels", short_name: "Stock", url: "/stock-levels", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
