import { recordAudit } from "@/lib/erp/services";
import { assertCanChange, sessionTenant } from "@/lib/notify/whatsapp/pharmacy-scope";
import { addRecipient } from "@/lib/notify/whatsapp/service";
import { guarded } from "@/lib/session";

/** Adds a WhatsApp recipient. Requires confirmation that the person agreed; the consent date is recorded. */
export async function POST(request: Request) {
  return guarded("settings.manage", async (actor) => {
    assertCanChange(actor);
    const recipient = await addRecipient(sessionTenant(), actor.name, await request.json().catch(() => null));
    recordAudit(actor, { action: "whatsapp.recipient-add", entity: "WhatsAppRecipient", entityId: recipient.id, summary: `Added WhatsApp recipient ${recipient.name} (${recipient.phone}) with consent recorded`, severity: "warning" });
    return recipient;
  }, 201);
}
