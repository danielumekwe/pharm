import { recordAudit } from "@/lib/erp/services";
import { assertCanChange, sessionTenant } from "@/lib/notify/whatsapp/pharmacy-scope";
import { removeRecipient, updateRecipient } from "@/lib/notify/whatsapp/service";
import { guarded } from "@/lib/session";

/** Changes a recipient's notification types, or opts them out / back in (opting in needs fresh consent). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("settings.manage", async (actor) => {
    assertCanChange(actor);
    const recipient = await updateRecipient(sessionTenant(), id, actor.name, await request.json().catch(() => null));
    recordAudit(actor, { action: "whatsapp.recipient-update", entity: "WhatsAppRecipient", entityId: id, summary: `WhatsApp recipient ${recipient.name}: ${recipient.opted_out_at ? "opted out" : "receiving"} (${recipient.types.length} type(s))` });
    return recipient;
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("settings.manage", async (actor) => {
    assertCanChange(actor);
    await removeRecipient(sessionTenant(), id);
    recordAudit(actor, { action: "whatsapp.recipient-remove", entity: "WhatsAppRecipient", entityId: id, summary: "Removed a WhatsApp recipient" });
    return { ok: true };
  });
}
