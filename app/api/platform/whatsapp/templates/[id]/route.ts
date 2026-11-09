import { saveTemplate } from "@/lib/notify/whatsapp/service";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformGuarded } from "@/lib/platform/session";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("settings.manage", async (actor) => {
    const template = await saveTemplate(actor.name, id, await request.json().catch(() => null));
    await recordPlatformAudit(platformActorRef(actor), { action: "whatsapp.template-update", targetType: "WhatsAppTemplate", targetId: id, summary: `Updated WhatsApp template "${template.name}": ${template.status}${template.active ? "" : ", inactive"}`, severity: "warning" });
    return template;
  });
}
