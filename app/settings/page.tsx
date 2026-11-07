import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { getDb } from "@/lib/db/database";
import { DEFAULT_SETTINGS, getStore } from "@/lib/erp/store";
import { pageData } from "@/lib/session";

import { PosSettingsPanel } from "./pos-settings";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  return pageData("settings.manage", "/settings", async () => {
    const store = getStore();
    return (
      <DashboardShell>
        <SettingsForm
          settings={{ ...store.settings }}
          defaults={DEFAULT_SETTINGS}
          database={getDb()?.stats() ?? null}
          history={store.audit.filter((event) => event.action.startsWith("settings.")).slice(0, 10).map((event) => ({ id: event.id, at: event.at, actor: event.actorName, summary: event.summary }))}
        />
        <div className="mt-6">
          <PosSettingsPanel pos={store.settings.pos} targets={store.settings.salesTargets} outlets={outlets.filter((outlet) => outlet.type !== "WAREHOUSE").map((outlet) => ({ id: outlet.id, name: outlet.name }))} />
        </div>
      </DashboardShell>
    );
  });
}
