import type { MetadataRoute } from "next";

function origin() {
  try {
    return new URL(process.env.APP_URL || process.env.NEXTAUTH_URL || "").origin;
  } catch {
    return null;
  }
}

/** Search engines may index the public homepage; the app itself sits behind sign-in. */
export default function robots(): MetadataRoute.Robots {
  const base = origin();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/platform"] },
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
