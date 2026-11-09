import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { outlets } from "@/lib/data";
import { currentTenant } from "@/lib/db/database";
import { NOTIFICATION_TYPES, TYPE_KEYS } from "@/lib/notify/whatsapp/catalog";
import { listMessages, listRecipients, listTemplates, templateProblem, tenantPreferences, whatsappConfig } from "@/lib/notify/whatsapp/service";
import { pageData } from "@/lib/session";

import { WhatsAppSettings } from "./whatsapp-settings";

export const metadata = { title: "WhatsApp notifications" };

/** Pharmacy Super Admin: this pharmacy's WhatsApp recipients, preferences and message history only. */
export default async function WhatsAppSettingsPage() {
  return pageData("settings.manage", "/settings/whatsapp", async (actor) => {
    const tenantId = currentTenant()?.id;
    if (!tenantId) throw new Error("No pharmacy selected.");
    const [config, preferences, recipients, messages, templates] = await Promise.all([
      whatsappConfig().catch(() => null),
      tenantPreferences(tenantId),
      listRecipients(tenantId),
      listMessages({}, tenantId, 100),
      listTemplates(),
    ]);
    const types = TYPE_KEYS.map((key) => ({ key, label: NOTIFICATION_TYPES[key].label, platformOn: config?.value.types[key] !== false, problem: templateProblem(templates, key) ? "Not available yet: Web365 is still setting up the approved WhatsApp template for this message." : null }));
    return (
      <DashboardShell>
        <div className="space-y-6">
          <PageHeader eyebrow="Settings" title="WhatsApp notifications" description="Send the daily report, stock and expiry alerts and account notices to WhatsApp numbers your pharmacy authorises." />
          <WhatsAppSettings
            available={Boolean(config?.value.enabled && config.apiKey)}
            preferences={preferences}
            types={types}
            recipients={JSON.parse(JSON.stringify(recipients))}
            messages={JSON.parse(JSON.stringify(messages))}
            outlets={outlets.filter((outlet) => outlet.type !== "WAREHOUSE").map((outlet) => ({ id: outlet.id, name: outlet.name }))}
            readOnly={Boolean(actor.support)}
          />
        </div>
      </DashboardShell>
    );
  });
}
