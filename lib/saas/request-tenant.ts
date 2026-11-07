// The tenant of the current HTTP request, read from its signed credentials only:
// the mobile app's bearer token, or the NextAuth session cookie (both encrypted with AUTH_SECRET, so the
// tenant ID cannot be altered by the client). Whether the user still belongs to that tenant is checked
// afterwards against the live membership (lib/session.ts getActor).
import { decode } from "next-auth/jwt";
import { cookies, headers } from "next/headers";

import { AUTH_SECRET } from "@/lib/auth-secret";

const SESSION_COOKIES = ["__Secure-next-auth.session-token", "next-auth.session-token"];

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** NextAuth splits large tokens into name.0, name.1, … cookies. */
function sessionCookie(store: CookieStore) {
  for (const name of SESSION_COOKIES) {
    const whole = store.get(name)?.value;
    if (whole) return whole;
    const chunks: string[] = [];
    for (let index = 0; ; index += 1) {
      const chunk = store.get(`${name}.${index}`)?.value;
      if (!chunk) break;
      chunks.push(chunk);
    }
    if (chunks.length) return chunks.join("");
  }
  return null;
}

async function tenantFromToken(token: string, mobile: boolean) {
  try {
    const payload = await decode({ token, secret: AUTH_SECRET });
    if (!payload || (mobile && payload.mobile !== true)) return null;
    return typeof payload.tenantId === "string" && payload.tenantId ? payload.tenantId : null;
  } catch {
    return null;
  }
}

/** Tenant ID from the request's signed session, or null (anonymous, invalid, or not in a request). */
export async function requestTenantId(): Promise<string | null> {
  let headerList: Awaited<ReturnType<typeof headers>>;
  let cookieStore: CookieStore;
  try {
    headerList = await headers();
    cookieStore = await cookies();
  } catch {
    return null; // background job or start-up: no request
  }
  const authorization = headerList.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return tenantFromToken(authorization.slice(7).trim(), true);
  const session = sessionCookie(cookieStore);
  return session ? tenantFromToken(session, false) : null;
}
