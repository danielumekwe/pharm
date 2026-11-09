import { NextResponse } from "next/server";

import { authorizeCredentials } from "@/lib/auth";
import { withDatabaseTransaction } from "@/lib/db/database";
import { getOutletById, users } from "@/lib/data";
import { actorFor } from "@/lib/erp/access";
import { issueMobileToken, MOBILE_TOKEN_MAX_AGE } from "@/lib/mobile-token";
import { pharmaciesFor, verifiedAccountIds } from "@/lib/saas/identity";
import { RateLimitError } from "@/lib/saas/rate-limit";
import { runInTenant } from "@/lib/saas/tenant";

/**
 * Native app sign-in: same rules as the web sign-in, returns a bearer token for one pharmacy and the user's
 * profile there. An account in several pharmacies must send `tenantId`; without it the answer is 409 with the
 * pharmacies to choose from (after the password has been checked).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    let user;
    try {
      user = await authorizeCredentials(body);
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      const message = error instanceof Error ? error.message : "Sign-in failed.";
      if (message.startsWith("Choose the pharmacy") && body && typeof body === "object") {
        const { identifier, password } = body as { identifier?: unknown; password?: unknown };
        const ids = typeof identifier === "string" && typeof password === "string" ? await verifiedAccountIds(identifier, password) : [];
        const pharmacies = (await pharmaciesFor(ids)).filter((entry) => entry.status === "ACTIVE").map((entry) => ({ tenantId: entry.tenantId, name: entry.name, role: entry.roleLabel, locations: entry.locations }));
        return NextResponse.json({ error: message, pharmacies }, { status: 409 });
      }
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (!user) return NextResponse.json({ error: "Wrong email/staff ID or password." }, { status: 401 });
    const signedIn = user;
    return await runInTenant(signedIn.tenantId, () => withDatabaseTransaction(async () => {
      const record = users.find((row) => row.id === signedIn.id);
      const actor = record ? actorFor(record, signedIn.outletId) : null;
      if (!actor) return NextResponse.json({ error: "This account cannot sign in." }, { status: 403 });
      const token = await issueMobileToken({ id: actor.id, outletId: actor.outletId, tenantId: signedIn.tenantId });
      return NextResponse.json({
        token,
        expiresAt: new Date(Date.now() + MOBILE_TOKEN_MAX_AGE * 1000).toISOString(),
        user: {
          id: actor.id,
          name: actor.name,
          email: record?.email ?? "",
          role: actor.role,
          tenantId: signedIn.tenantId,
          outletId: actor.outletId,
          outlets: actor.outletIds.map((id) => ({ id, name: getOutletById(id)?.name ?? id })),
          permissions: actor.permissions,
        },
        // Where this account may sign in at this pharmacy (for the app's location switcher).
        pharmacy: await pharmacyFor(body, signedIn.tenantId),
      });
    }));
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    console.error("[mobile-login]", error);
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
}

/** The signed-in pharmacy's name and the locations this account may use there (password already verified). */
async function pharmacyFor(body: unknown, tenantId: string) {
  const { identifier, password } = (body ?? {}) as { identifier?: unknown; password?: unknown };
  if (typeof identifier !== "string" || typeof password !== "string") return null;
  const entry = (await pharmaciesFor(await verifiedAccountIds(identifier, password))).find((row) => row.tenantId === tenantId);
  return entry ? { tenantId, name: entry.name, role: entry.roleLabel, locations: entry.locations, defaultLocationId: entry.defaultLocationId } : null;
}
