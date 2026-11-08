import { NextResponse } from "next/server";
import { z } from "zod";

import { recordSignInAttempt } from "@/lib/platform/security";
import { pharmaciesFor, suspendedMessage, suspendedPharmaciesFor, verifiedAccountIds } from "@/lib/saas/identity";
import { limitSignIn, RateLimitError, recordSignInFailure } from "@/lib/saas/rate-limit";

const schema = z.object({ identifier: z.string().trim().min(3).max(120), password: z.string().min(6).max(128) });

/**
 * Step 1 of sign-in: after the password is checked, lists the pharmacies this account belongs to and the
 * locations it may choose in each. Nothing is listed for a wrong password, so the sign-in page reveals no
 * pharmacy or outlet names to anyone else.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email or staff ID and password." }, { status: 400 });
  const { identifier, password } = parsed.data;
  try {
    await limitSignIn(identifier);
    const ids = await verifiedAccountIds(identifier, password);
    if (!ids.length) {
      recordSignInFailure(identifier);
      await recordSignInAttempt({ surface: "pharmacy", identifier, outcome: "bad_password" });
      return NextResponse.json({ error: "Email/staff ID or password is incorrect." }, { status: 401 });
    }
    const choices = await pharmaciesFor(ids);
    const usable = choices.filter((entry) => entry.status === "ACTIVE");
    if (!usable.length) {
      const suspendedPharmacies = await suspendedPharmaciesFor(ids);
      if (suspendedPharmacies.length) return NextResponse.json({ error: suspendedMessage(suspendedPharmacies) }, { status: 403 });
      const invited = choices.some((entry) => entry.status === "INVITED");
      const suspended = choices.some((entry) => entry.status === "SUSPENDED");
      const error = suspended ? "This account is suspended. Contact your manager." : invited ? "This account has not been activated yet. Use the invitation link you were sent." : "This account does not have access to an active pharmacy.";
      return NextResponse.json({ error }, { status: 403 });
    }
    return NextResponse.json({
      pharmacies: usable.map((entry) => ({ tenantId: entry.tenantId, name: entry.name, role: entry.roleLabel, locations: entry.locations, defaultLocationId: entry.defaultLocationId })),
    });
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    console.error("[sign-in pharmacies]", error);
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  }
}
