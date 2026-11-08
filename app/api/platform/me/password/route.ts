import { NextResponse } from "next/server";
import { z } from "zod";

import { changePlatformPassword } from "@/lib/platform/security";
import { platformGuarded, startPlatformSession } from "@/lib/platform/session";

const schema = z.object({ current: z.string().min(1).max(128), next: z.string().min(1).max(128) });

/** Changes one's own password. All sessions end; this device gets a new one. */
export async function POST(request: Request) {
  return platformGuarded("self", async (actor) => {
    const input = schema.parse(await request.json());
    await changePlatformPassword(actor, input.current, input.next);
    return startPlatformSession(NextResponse.json({ ok: true }), actor, request, { twoFactor: Boolean(actor.twoFactor) });
  });
}
