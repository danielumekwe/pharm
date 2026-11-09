import { listTemplates, saveTemplate } from "@/lib/notify/whatsapp/service";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformGuarded } from "@/lib/platform/session";

/** WhatsApp templates as recorded from Zoho CPaaS (approval status is set by Web365 after checking Zoho). */
export async function GET() {
  return platformGuarded("settings.manage", async () => ({ templates: await listTemplates() }));
}

export async function POST(request: Request) {
  return platformGuarded("settings.manage", async (actor) => {
    const template = await saveTemplate(actor.name, null, await request.json().catch(() => null));
    await recordPlatformAudit(platformActorRef(actor), { action: "whatsapp.template-add", targetType: "WhatsAppTemplate", targetId: template.id, summary: `Added WhatsApp template "${template.name}" for ${template.notification_type} (${template.status})` });
    return template;
  }, 201);
}
