import { NextResponse } from "next/server";

/**
 * Reachability check for the installed app: answers only when the request really reached the server
 * (a device can be on Wi-Fi with no internet). No session, no database, nothing cached.
 */
export function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
