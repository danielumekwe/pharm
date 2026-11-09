import { NextResponse } from "next/server";
import { z } from "zod";

import { optOutByToken } from "@/lib/notify/whatsapp/service";

/**
 * Public: opts a recipient out using the signed link in their WhatsApp messages. The link is an HMAC of the
 * recipient ID, so it cannot be guessed or changed; the global API rate limits apply.
 */
export async function POST(request: Request) {
  const parsed = z.object({ t: z.string().min(10).max(300) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "This opt-out link is not valid." }, { status: 400 });
  try {
    const pharmacy = await optOutByToken(parsed.data.t);
    if (!pharmacy) return NextResponse.json({ error: "This opt-out link is not valid." }, { status: 400 });
    return NextResponse.json({ ok: true, pharmacy });
  } catch (error) {
    console.error("[whatsapp-unsubscribe]", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Please try again later." }, { status: 503 });
  }
}
