import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

import { AUTH_SECRET } from "@/lib/auth-secret";

// Authentication only. Authorisation needs the live permission matrix and user record,
// so it is enforced by every page (requirePage) and API route (guarded) on the server.
export default withAuth(
  function proxy() {
    return NextResponse.next();
  },
  {
    secret: AUTH_SECRET,
    pages: { signIn: "/login" },
    callbacks: {
      authorized: ({ token }) => Boolean(token?.id),
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
  ],
};
