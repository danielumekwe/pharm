import { recordAudit } from "@/lib/erp/services";
import { assertCanChange, sessionTenant } from "@/lib/notify/whatsapp/pharmacy-scope";
import { listRecipients, tenantPreferences, updateTenantPreferences } from "@/lib/notify/whatsapp/service";
import { guarded } from "@/lib/session";

/** This pharmacy's WhatsApp preferences and recipients (Pharmacy Super Admin). */
export async function GET() {
  return guarded("settings.manage", async () => {
    const tenantId = sessionTenant();
    return { preferences: await tenantPreferences(tenantId), recipients: await listRecipients(tenantId) };
  });
}

/** Daily report channel (email, WhatsApp or both) and which notification types the pharmacy wants. */
export async function PATCH(request: Request) {
  return guarded("settings.manage", async (actor) => {
    assertCanChange(actor);
    const preferences = await updateTenantPreferences(sessionTenant(), actor.name, await request.json().catch(() => null));
    const off = Object.entries(preferences.types).filter(([, on]) => !on).map(([key]) => key);
    recordAudit(actor, { action: "whatsapp.preferences", entity: "Settings", entityId: "whatsapp", summary: `WhatsApp: daily report by ${preferences.dailyReportChannel}${off.length ? `; switched off: ${off.join(", ")}` : ""}` });
    return { preferences };
  });
}
