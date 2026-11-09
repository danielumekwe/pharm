import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { platformQuery } from "@/lib/db/database";
import { NOTIFICATION_TYPES, TYPE_KEYS } from "@/lib/notify/whatsapp/catalog";
import { listTemplates, templateProblem } from "@/lib/notify/whatsapp/service";
import { requirePlatformPage } from "@/lib/platform/pages";
import { secretsAvailable } from "@/lib/platform/secrets";
import { describePlatformSetting, lastChecks } from "@/lib/platform/settings";

import { Templates, TestMessage, WhatsAppSettingsForm } from "./whatsapp-form";

export const metadata = { title: "WhatsApp · Web365 platform" };

const time = (value: Date | string | null) => (value ? new Date(value).toISOString().replace("T", " ").slice(0, 16) : "—");

export default async function WhatsAppSettingsPage() {
  const actor = await requirePlatformPage("settings.manage");
  const [setting, checks, templates, stats] = await Promise.all([
    describePlatformSetting("whatsapp.zoho"),
    lastChecks("whatsapp"),
    listTemplates(),
    platformQuery<Array<{ status: string; count: number }>>((query) => query(`SELECT status, count(*)::int AS count FROM whatsapp_messages WHERE created_at > now() - interval '24 hours' GROUP BY status`)),
  ]);
  const types = TYPE_KEYS.map((key) => ({ key, label: NOTIFICATION_TYPES[key].label, variables: NOTIFICATION_TYPES[key].variables }));
  const problems = Object.fromEntries(TYPE_KEYS.map((key) => [key, templateProblem(templates, key)]));
  const count = (name: string) => stats.find((row) => row.status === name)?.count ?? 0;
  const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  return (
    <PlatformShell actor={actor}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp (Zoho CPaaS)</h1>
          <p className="text-sm text-slate-600">Pharmacy reports, stock and expiry alerts, billing and account notices on WhatsApp, sent with approved templates through Zoho CPaaS.</p>
        </div>
        <Link href="/platform/whatsapp" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Message history</Link>
      </div>
      {!secretsAvailable() ? <p role="alert" className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">Secret storage is not set up on this server (SETTINGS_ENCRYPTION_KEY). Credentials cannot be saved until it is.</p> : null}

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <WhatsAppSettingsForm setting={JSON.parse(JSON.stringify(setting))} types={types} webhookUrl={`${base}/api/webhooks/zoho-cpaas`} />
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" data-whatsapp-status>
            <h2 className="font-semibold">Connection</h2>
            <p className="mt-1">{setting.value.enabled ? "On" : "Off"} · WABA {setting.value.wabaId || "—"} · sender {setting.value.senderNumber || "not set"}</p>
            <p className="mt-2 text-slate-600">Last check: {checks.last ? `${checks.last.ok ? "succeeded" : "failed"} at ${time(checks.last.at)} UTC — ${checks.last.detail}` : "never run"}</p>
            {checks.lastError ? <p className="text-rose-700">Last error: {checks.lastError.detail} ({time(checks.lastError.at)} UTC)</p> : null}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" data-whatsapp-stats>
            <h2 className="font-semibold">Last 24 hours</h2>
            <p className="mt-1">{count("SENT") + count("DELIVERED") + count("READ")} accepted ({count("DELIVERED") + count("READ")} delivered, {count("READ")} read) · {count("QUEUED") + count("SENDING")} waiting · <span className={count("FAILED") + count("UNDELIVERED") ? "text-rose-700" : ""}>{count("FAILED")} failed, {count("UNDELIVERED")} undelivered</span> · {count("SKIPPED")} not sent</p>
            <p className="mt-2 text-xs text-slate-500">Temporary failures are retried after 1, 5, 30 and 120 minutes; refused requests and rejected templates are not retried. Messages not sent within 24 hours are dropped.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5"><TestMessage templates={JSON.parse(JSON.stringify(templates))} /></div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <Templates templates={JSON.parse(JSON.stringify(templates))} types={types} problems={problems} />
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Change history</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm" data-settings-history>
          {setting.history.length === 0 ? <li className="py-2 text-slate-500">No changes yet.</li> : setting.history.map((entry, index) => (
            <li key={index} className="py-2"><span className="text-slate-500">{time(entry.at)} UTC · {entry.by}</span><span className="block">{entry.changes.join("; ")}</span></li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
