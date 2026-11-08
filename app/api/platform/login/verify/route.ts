import { NextResponse } from "next/server";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { platformLockout, recordSignInAttempt, securityPolicy, verifySecondFactor } from "@/lib/platform/security";
import { endTwoFactorChallenge, startPlatformSession, twoFactorChallengeUser } from "@/lib/platform/session";

const schema = z.object({ code: z.string().trim().min(6).max(20) });

/** Sign-in step 2: the code from the authenticator app, or a recovery code. Failures count towards lockout. */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the 6-digit code from your app, or a recovery code." }, { status: 400 });
  try {
    const userId = await twoFactorChallengeUser();
    if (!userId) return NextResponse.json({ error: "The sign-in has expired. Enter your password again.", restart: true }, { status: 401 });
    const [user] = await platformQuery<Array<{ id: string; email: string; name: string; role: string; status: string }>>((query) => query(`SELECT id, email, name, role, status FROM platform_users WHERE id = $1`, [userId]));
    if (!user || user.status !== "ACTIVE") return endTwoFactorChallenge(NextResponse.json({ error: "This account cannot sign in.", restart: true }, { status: 401 }));
    const policy = await securityPolicy();
    const locked = await platformLockout(user.email, policy);
    if (locked) {
      await recordSignInAttempt({ surface: "platform", identifier: user.email, outcome: "locked", userId });
      return endTwoFactorChallenge(NextResponse.json({ error: `Too many failed attempts. Try again in ${locked} minute(s).`, restart: true }, { status: 429 }));
    }
    const factor = await verifySecondFactor(userId, parsed.data.code);
    if (!factor) {
      await recordSignInAttempt({ surface: "platform", identifier: user.email, outcome: "two_factor_failed", userId });
      await recordPlatformAudit({ id: userId, name: `${user.name} (Web365)`, type: "platform" }, { action: "platform.login-failed", summary: `Wrong two-factor code for ${user.email}`, severity: "warning" });
      return NextResponse.json({ error: "That code is not right." }, { status: 401 });
    }
    await recordSignInAttempt({ surface: "platform", identifier: user.email, outcome: "success", userId, detail: factor === "recovery" ? "recovery code" : "authenticator app" });
    await recordPlatformAudit({ id: userId, name: `${user.name} (Web365)`, type: "platform" }, {
      action: "platform.login", severity: factor === "recovery" ? "warning" : "info",
      summary: `${user.name} signed in to the platform with ${factor === "recovery" ? "a recovery code" : "two-factor sign-in"}`,
    });
    const response = await startPlatformSession(NextResponse.json({ ok: true, name: user.name, role: user.role, usedRecoveryCode: factor === "recovery" }), { id: userId }, request, { twoFactor: true });
    return endTwoFactorChallenge(response);
  } catch (error) {
    console.error("[platform-login-verify]", error);
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  }
}
