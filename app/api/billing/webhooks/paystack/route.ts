import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { platformQuery } from "@/lib/db/database";
import { paystack } from "@/lib/billing/paystack";
import { settlePayment } from "@/lib/billing/service";
import { recordPlatformAudit } from "@/lib/platform/audit";

/**
 * Paystack webhook. The signature is checked over the raw body; each event is processed once (a repeated
 * delivery is acknowledged and ignored). The event body is never trusted for the payment itself:
 * settlePayment() verifies with Paystack's API. On an error the answer is 500, so Paystack retries.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!paystack.verifyWebhook(raw, request.headers)) {
    await recordPlatformAudit({ id: null, name: "Paystack webhook", type: "system" }, { action: "billing.webhook-rejected", summary: "Webhook with a missing or wrong signature was rejected", severity: "warning" }).catch(() => undefined);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  let event;
  try {
    event = paystack.parseWebhook(raw);
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const [stored] = await platformQuery<Array<{ id: string; processed_at: Date | null }>>((query) =>
    query(
      `INSERT INTO webhook_events (id, provider, event_key, event_type, reference, payload) VALUES ($1, 'paystack', $2, $3, $4, $5)
       ON CONFLICT (provider, event_key) DO UPDATE SET event_key = EXCLUDED.event_key
       RETURNING id, processed_at`,
      [`wh-${randomUUID()}`, event.key, event.type, event.reference, raw],
    ),
  );
  if (stored.processed_at) return NextResponse.json({ ok: true, duplicate: true });

  let result = "ignored";
  try {
    if (event.type === "charge.success" && event.reference) {
      const settlement = await settlePayment(event.reference, "webhook");
      result = settlement.outcome;
      if (settlement.outcome === "unknown") {
        await recordPlatformAudit({ id: null, name: "Paystack webhook", type: "system" }, { action: "billing.unknown-payment", targetType: "Payment", targetId: event.reference, summary: `Paystack reported a successful charge for unknown reference ${event.reference}; check it by hand`, severity: "critical" });
      }
      if (settlement.outcome === "pending") throw new Error("Payment not confirmed yet");
    }
    await platformQuery((query) => query(`UPDATE webhook_events SET processed_at = now(), result = $1 WHERE id = $2`, [result, stored.id]));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[paystack-webhook]", error);
    await platformQuery((query) => query(`UPDATE webhook_events SET result = $1 WHERE id = $2`, [`error: ${error instanceof Error ? error.message : "unknown"}`.slice(0, 300), stored.id])).catch(() => undefined);
    return NextResponse.json({ error: "Not processed; please retry." }, { status: 500 });
  }
}
