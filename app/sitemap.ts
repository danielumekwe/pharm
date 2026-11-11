import type { MetadataRoute } from "next";

/** Public pages only: the homepage, registration and sign-in. */
export default function sitemap(): MetadataRoute.Sitemap {
  let base: string;
  try {
    base = new URL(process.env.APP_URL || process.env.NEXTAUTH_URL || "").origin;
  } catch {
    return [];
  }
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/register`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
