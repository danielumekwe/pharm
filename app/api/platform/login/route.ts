import { NextResponse } from "next/server";
import { z } from "zod";

import { recordPlatformAudit } from "@/lib/platform/audit";
import { ipAllowed, platformLockout, recordSignInAttempt, securityPolicy } from "@/lib/platform/security";
import { startPlatformSession, startTwoFactorChallenge, verifyPlatformCredentials } from "@/lib/platform/session";
import { clientAddress, hit, RateLimitError } from "@/lib/saas/rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(160), password: z.string().min(1).max(128) });

/**
 * Web365 staff sign-in, step 1 (separate from pharmacy sign-in). Every attempt is logged. Accounts lock after
 * the policy's number of failures; with two-factor sign-in on, a correct password only opens step 2.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  const { email, password } = parsed.data;
  try {
    const policy = await securityPolicy();
    if (!ipAllowed(await clientAddress(), policy.ipAllowlist)) {
      await recordSignInAttempt({ surface: "platform", identifier: email, outcome: "blocked_ip" });
      return NextResponse.json({ error: "The Control Centre cannot be used from this network." }, { status: 403 });
    }
    hit(`platform-login:ip:${await clientAddress()}`, 30, 15 * 60_000);
    const locked = await platformLockout(email, policy);
    if (locked) {
      await recordSignInAttempt({ surface: "platform", identifier: email, outcome: "locked" });
      return NextResponse.json({ error: `Too many failed attempts. Try again in ${locked} minute(s).` }, { status: 429 });
    }
    const result = await verifyPlatformCredentials(email, password);
    if (!result.actor) {
      await recordSignInAttempt({ surface: "platform", identifier: email, outcome: "bad_password", userId: result.userId });
      await recordPlatformAudit({ id: null, name: email, type: "platform" }, { action: "platform.login-failed", summary: `Failed platform sign-in for ${email}`, severity: "warning" });
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    const { actor } = result;
    if (result.twoFactor) {
      await recordSignInAttempt({ surface: "platform", identifier: email, outcome: "two_factor_required", userId: actor.id });
      return startTwoFactorChallenge(NextResponse.json({ ok: true, twoFactor: true }), actor.id, request);
    }
    await recordSignInAttempt({ surface: "platform", identifier: email, outcome: "success", userId: actor.id });
    await recordPlatformAudit({ id: actor.id, name: `${actor.name} (Web365)`, type: "platform" }, { action: "platform.login", summary: `${actor.name} signed in to the platform` });
    return startPlatformSession(NextResponse.json({ ok: true, name: actor.name, role: actor.role }), actor, request, { twoFactor: false });
  } catch (error) {
    if (error instanceof RateLimitError || (error instanceof Error && error.name === "RateLimitError")) {
      await recordSignInAttempt({ surface: "platform", identifier: email, outcome: "rate_limited" });
      return NextResponse.json({ error: (error as Error).message }, { status: 429 });
    }
    console.error("[platform-login]", error);
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  }
}
