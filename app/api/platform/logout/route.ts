import { NextResponse } from "next/server";

import { platformQuery } from "@/lib/db/database";
import { endPlatformSession, platformSessionId } from "@/lib/platform/session";

/** Signs out: the session is ended on the server too, so a copied cookie stops working. */
export async function POST() {
  const sessionId = await platformSessionId();
  if (sessionId) await platformQuery((query) => query(`UPDATE platform_sessions SET revoked_at = now(), revoke_reason = 'Signed out' WHERE id = $1 AND revoked_at IS NULL`, [sessionId])).catch(() => undefined);
  return endPlatformSession(NextResponse.json({ ok: true }));
}
