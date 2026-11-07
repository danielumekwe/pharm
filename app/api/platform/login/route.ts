import { NextResponse } from "next/server";
import { z } from "zod";

import { recordPlatformAudit } from "@/lib/platform/audit";
import { startPlatformSession, verifyPlatformCredentials } from "@/lib/platform/session";
import { check, clientAddress, hit, RateLimitError } from "@/lib/saas/rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(160), password: z.string().min(1).max(128) });

/** Web365 staff sign-in (separate from pharmacy sign-in). */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  const { email, password } = parsed.data;
  try {
    hit(`platform-login:ip:${await clientAddress()}`, 30, 15 * 60_000);
    check(`platform-login:fail:${email}`, 5);
    const actor = await verifyPlatformCredentials(email, password);
    if (!actor) {
      hit(`platform-login:fail:${email}`, Number.MAX_SAFE_INTEGER, 15 * 60_000);
      await recordPlatformAudit({ id: null, name: email, type: "platform" }, { action: "platform.login-failed", summary: `Failed platform sign-in for ${email}`, severity: "warning" });
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    await recordPlatformAudit({ id: actor.id, name: `${actor.name} (Web365)`, type: "platform" }, { action: "platform.login", summary: `${actor.name} signed in to the platform` });
    return startPlatformSession(NextResponse.json({ ok: true, name: actor.name, role: actor.role }), actor, request);
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    console.error("[platform-login]", error);
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  }
}
