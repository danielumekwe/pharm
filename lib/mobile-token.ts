// Signed bearer tokens for the native mobile app. Same secret and JWE format as the web session,
// but carried in the Authorization header instead of a cookie.
import { decode, encode } from "next-auth/jwt";
import { headers } from "next/headers";

import { AUTH_SECRET } from "@/lib/auth-secret";

export const MOBILE_TOKEN_MAX_AGE = 60 * 60 * 12; // one working shift, like the web session

/** tenantId: the pharmacy the token was issued for; the membership is re-checked on every request. */
export type MobileToken = { id: string; outletId: string | null; tenantId: string };

export function issueMobileToken(token: MobileToken) {
  return encode({ token: { id: token.id, outletId: token.outletId, tenantId: token.tenantId, mobile: true }, secret: AUTH_SECRET, maxAge: MOBILE_TOKEN_MAX_AGE });
}

/**
 * undefined: no Bearer header (fall back to the cookie session).
 * null: a Bearer header that is invalid or expired.
 */
export async function bearerToken(): Promise<MobileToken | null | undefined> {
  const header = (await headers()).get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  try {
    const payload = await decode({ token: header.slice(7).trim(), secret: AUTH_SECRET });
    if (!payload || payload.mobile !== true || typeof payload.id !== "string" || typeof payload.tenantId !== "string") return null;
    return { id: payload.id, outletId: typeof payload.outletId === "string" ? payload.outletId : null, tenantId: payload.tenantId };
  } catch {
    return null;
  }
}
