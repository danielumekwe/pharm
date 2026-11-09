import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "next-auth/middleware";

import { AUTH_SECRET } from "@/lib/auth-secret";
import { enforceApiRateLimit } from "@/lib/saas/rate-limit";

// Authentication only. Authorisation needs the live permission matrix and user record,
// so it is enforced by every page (requirePage) and API route (guarded) on the server.
export default withAuth(
  async function proxy(request: NextRequest) {
    if (!request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
    try {
      const result = await enforceApiRateLimit(request);
      if (!result.enabled) return NextResponse.next();
      if (result.response) return result.response;
      const response = NextResponse.next();
      response.headers.set("RateLimit-Limit", String(result.limit));
      response.headers.set("RateLimit-Remaining", String(result.remaining));
      response.headers.set("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
      return response;
    } catch (error) {
      console.error("[rate-limit] enforcement bootstrap failed", error instanceof Error ? error.name : "unknown");
      return NextResponse.json({ error: "API protection is temporarily unavailable." }, { status: 503 });
    }
  },
  {
    secret: AUTH_SECRET,
    pages: { signIn: "/login" },
    callbacks: {
      // Route handlers retain their existing auth/permission checks. Public endpoints must reach
      // their handler, but still pass through the global API limiter.
      authorized: ({ token, req }) => req.nextUrl.pathname.startsWith("/api/") || Boolean(token?.id),
    },
  },
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/support-access/:path*",
    "/support/:path*",
    "/help/:path*",
    "/sales/:path*",
    "/sales-overview/:path*",
    "/alerts/:path*",
    "/purchase/:path*",
    "/contacts/:path*",
    "/products/:path*",
    "/inventory/:path*",
    "/stock/:path*",
    "/finance/:path*",
    "/billing/:path*",
    "/outlets/:path*",
    "/reports/:path*",
    "/regulatory/:path*",
    "/audit/:path*",
    "/users/:path*",
    "/permissions/:path*",
    "/settings/:path*",
    "/partners/:path*",
    "/repairs/:path*",
    "/sms/:path*",
    "/email/:path*",
    "/api/:path*",
  ],
};
