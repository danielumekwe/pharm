import { DashboardShell } from "@/components/dashboard-shell";
import { getDb } from "@/lib/db/database";
import { DEFAULT_SETTINGS, getStore } from "@/lib/erp/store";
import { requirePage } from "@/lib/session";

import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  await requirePage("settings.manage", "/settings");
  const store = getStore();
  return (
    <DashboardShell>
      <SettingsForm
        settings={{ ...store.settings }}
        defaults={DEFAULT_SETTINGS}
        database={getDb()?.stats() ?? null}
        history={store.audit.filter((event) => event.action.startsWith("settings.")).slice(0, 10).map((event) => ({ id: event.id, at: event.at, actor: event.actorName, summary: event.summary }))}
      />
    </DashboardShell>
  );
}
