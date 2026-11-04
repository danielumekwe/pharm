import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

// Cloudflare bindings (R2, Hyperdrive) for `next dev` only; never during builds or on other hosts such as Vercel.
if (process.env.NODE_ENV === "development" && !process.env.VERCEL) {
  import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
