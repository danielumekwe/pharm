import { NextResponse } from "next/server";

import { authorizeCredentials } from "@/lib/auth";
import { flushDatabase, withDatabaseTransaction } from "@/lib/db/database";
import { getOutletById, users } from "@/lib/data";
import { actorFor } from "@/lib/erp/access";
import { issueMobileToken, MOBILE_TOKEN_MAX_AGE } from "@/lib/mobile-token";

/** Native app sign-in: same rules as the web sign-in, returns a bearer token and the user's profile. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    return await withDatabaseTransaction(async () => {
      let user;
      try {
        user = await authorizeCredentials(body);
      } catch (error) {
        await flushDatabase();
        return NextResponse.json({ error: error instanceof Error ? error.message : "Sign-in failed." }, { status: 403 });
      }
      await flushDatabase(); // persists the audit entry (success or failure)
      if (!user) return NextResponse.json({ error: "Wrong email/staff ID or password." }, { status: 401 });
      const record = users.find((row) => row.id === user.id);
      const actor = record ? actorFor(record, user.outletId) : null;
      if (!actor) return NextResponse.json({ error: "This account cannot sign in." }, { status: 403 });
      const token = await issueMobileToken({ id: actor.id, outletId: actor.outletId });
      return NextResponse.json({
        token,
        expiresAt: new Date(Date.now() + MOBILE_TOKEN_MAX_AGE * 1000).toISOString(),
        user: {
          id: actor.id,
          name: actor.name,
          email: record?.email ?? "",
          role: actor.role,
          outletId: actor.outletId,
          outlets: actor.outletIds.map((id) => ({ id, name: getOutletById(id)?.name ?? id })),
          permissions: actor.permissions,
        },
      });
    });
  } catch (error) {
    console.error("[mobile-login]", error);
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
}
