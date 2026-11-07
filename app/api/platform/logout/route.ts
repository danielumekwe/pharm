import { NextResponse } from "next/server";

import { endPlatformSession } from "@/lib/platform/session";

export async function POST() {
  return endPlatformSession(NextResponse.json({ ok: true }));
}
