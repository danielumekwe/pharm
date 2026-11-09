import { sendTestMessage } from "@/lib/notify/whatsapp/service";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformGuarded } from "@/lib/platform/session";

/**
 * Sends one real WhatsApp test message, now, to a number the admin typed and confirmed has agreed to it,
 * using an approved template with clearly marked test values.
 */
export async function POST(request: Request) {
  return platformGuarded("settings.manage", async (actor) => {
    const result = await sendTestMessage(actor, await request.json().catch(() => null));
    await recordPlatformAudit(platformActorRef(actor), { action: "whatsapp.test-send", targetType: "WhatsApp", summary: `WhatsApp test message: ${result.ok ? "accepted by Zoho" : `not sent (${result.detail})`}`, severity: result.ok ? "info" : "warning" });
    return result;
  });
}
