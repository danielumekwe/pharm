import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
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
          history={store.audit.filter((event) => event.action.startsWith("settings.")).slice(0, 10).map((event) => ({ id: event.id, at: event.at, actor: event.actorName, summary: event.summary }))}
        />
        <Link href="/settings/whatsapp" className="mt-6 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 text-sm hover:border-slate-600" data-whatsapp-link>
          <span><span className="block font-semibold text-white">WhatsApp notifications</span><span className="text-slate-400">Daily report by email, WhatsApp or both; recipients and consent; message history.</span></span>
          <span className="text-sky-300">Open →</span>
        </Link>
        <div className="mt-6">
          <PosSettingsPanel pos={store.settings.pos} targets={store.settings.salesTargets} outlets={outlets.filter((outlet) => outlet.type !== "WAREHOUSE").map((outlet) => ({ id: outlet.id, name: outlet.name }))} />
        </div>
      </DashboardShell>
    );
  });
}
