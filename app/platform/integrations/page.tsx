import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { integrations } from "@/lib/platform/integrations";
import { requirePlatformPage } from "@/lib/platform/pages";

export const metadata = { title: "Integrations · Web365 platform" };

const BADGE: Record<string, [string, string]> = {
  connected: ["Connected", "bg-green-100 text-green-800"], configured: ["Set up, not yet confirmed", "bg-sky-100 text-sky-800"], not_configured: ["Not set up", "bg-slate-100 text-slate-700"],
  error: ["Problem", "bg-rose-100 text-rose-800"], off: ["Switched off", "bg-amber-100 text-amber-800"],
};

export default async function IntegrationsPage() {
  const actor = await requirePlatformPage("settings.manage");
  const list = await integrations();
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Integrations</h1>
      <p className="text-sm text-slate-600">Outside services the platform uses. “Connected” is shown only after a real check succeeded.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2" data-integrations>
        {list.map((item) => (
          <div key={item.name} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm" data-integration={item.name} data-status={item.status}>
            <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{item.name}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[item.status][1]}`}>{BADGE[item.status][0]}</span></div>
            <p className="text-xs text-slate-500">{item.purpose}</p>
            <p className="mt-2 text-slate-700">{item.detail}</p>
            <p className="mt-2 flex justify-between text-xs text-slate-500"><span>{item.lastCheck ? `Last check: ${item.lastCheck}` : ""}</span>{item.settingsHref ? <Link href={item.settingsHref} className="font-semibold text-green-800 hover:underline">Settings</Link> : null}</p>
          </div>
        ))}
      </div>
    </PlatformShell>
  );
}
