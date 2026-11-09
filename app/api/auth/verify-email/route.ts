import { NextResponse } from "next/server";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { consumeToken } from "@/lib/saas/auth-tokens";

const schema = z.object({ token: z.string().max(100) });

/** Public: confirms an email address from the link in the verification email (a button press, not the link itself). */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const userId = (await consumeToken(parsed.data.token, "verify_email"))?.userId;
    if (!userId) return NextResponse.json({ error: "This confirmation link is invalid, already used, or expired. Sign in to send a new one." }, { status: 400 });
    await platformQuery((query) => query(`UPDATE users SET email_verified_at = $1 WHERE id = $2 AND email_verified_at IS NULL`, [new Date().toISOString(), userId]));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[verify-email]", error);
    return NextResponse.json({ error: "Email confirmation is unavailable right now." }, { status: 503 });
  }
}
