import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { platformQuery } from "@/lib/db/database";
import { applyWebhookEvent, whatsappConfig } from "@/lib/notify/whatsapp/service";
import { parseWebhookEvents, verifyWebhook } from "@/lib/notify/whatsapp/zoho";
import { recordPlatformAudit } from "@/lib/platform/audit";

/**
 * Zoho CPaaS webhook for WhatsApp delivery events (delivered, read, undelivered).
 * Every event must carry a valid producer-signature (HMAC-SHA256 with the Authentication Key saved in the
 * Control Centre, timestamp within 5 minutes); anything else is rejected and nothing is changed. Each event
 * is applied once (webhook_events), and only to a message this platform sent.
 * Zoho's "Verify" button posts an empty, unsigned request: it gets 200 and changes nothing.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("producer-signature");
  if (!signature && !raw.trim()) return NextResponse.json({ ok: true });

  const { webhookKey } = await whatsappConfig().catch(() => ({ webhookKey: "" }));
  const payload = webhookKey ? verifyWebhook(raw, signature, webhookKey) : null;
  if (!payload) {
    await recordPlatformAudit({ id: null, name: "Zoho CPaaS webhook", type: "system" }, { action: "whatsapp.webhook-rejected", summary: webhookKey ? "WhatsApp webhook with a missing, expired or wrong signature was rejected" : "WhatsApp webhook rejected: no Authentication Key saved", severity: "warning" }).catch(() => undefined);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let events;
  try {
    events = parseWebhookEvents(payload);
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const results: string[] = [];
  try {
    for (const event of events) {
      const [stored] = await platformQuery<Array<{ id: string; processed_at: Date | null }>>((query) =>
        query(
          `INSERT INTO webhook_events (id, provider, event_key, event_type, reference, payload) VALUES ($1, 'zoho_whatsapp', $2, $3, $4, $5)
           ON CONFLICT (provider, event_key) DO UPDATE SET event_key = EXCLUDED.event_key RETURNING id, processed_at`,
          [`wh-${randomUUID()}`, event.eventKey, `whatsapp_${event.kind}`, event.messageReference ?? event.clientReference, JSON.stringify(event)],
        ),
      );
      if (stored.processed_at) {
        results.push("duplicate");
        continue;
      }
      const result = await applyWebhookEvent(event);
      await platformQuery((query) => query(`UPDATE webhook_events SET processed_at = now(), result = $1 WHERE id = $2`, [result, stored.id]));
      results.push(result);
    }
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("[zoho-webhook]", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Not processed; please retry." }, { status: 500 });
  }
}
