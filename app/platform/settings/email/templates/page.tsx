import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { getTemplate, isTemplateKey, listTemplates, templateHistory } from "@/lib/notify/templates";
import { requirePlatformPage } from "@/lib/platform/pages";

import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Email templates · Web365 platform" };

export default async function EmailTemplatesPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const actor = await requirePlatformPage("settings.manage");
  const { key } = await searchParams;
  const templates = await listTemplates();
  const selected = key && isTemplateKey(key) ? key : templates[0].key;
  const [template, history] = await Promise.all([getTemplate(selected), templateHistory(selected)]);
  const time = (value: string | null) => (value ? value.replace("T", " ").slice(0, 16) : "—");
  return (
    <PlatformShell actor={actor}>
      <p className="text-sm"><Link href="/platform/settings/email" className="text-green-800 hover:underline">← Email</Link></p>
      <h1 className="text-2xl font-bold">Email templates</h1>
      <p className="text-sm text-slate-600">The emails the platform sends. Use {"{{variable}}"} to insert details; the text is turned into a simple, safe HTML email.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <nav className="rounded-2xl border border-slate-200 bg-white p-2 text-sm" data-template-list>
          {templates.map((item) => (
            <Link key={item.key} href={`?key=${item.key}`} className={`block rounded-lg px-3 py-2 ${item.key === selected ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>
              {item.label}{item.customised ? <span className={`ml-1 text-xs ${item.key === selected ? "text-emerald-300" : "text-green-700"}`}>· edited</span> : null}
            </Link>
          ))}
        </nav>
        <div className="space-y-4 lg:col-span-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <TemplateEditor key={selected} template={JSON.parse(JSON.stringify(template))} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">Change history</h2>
            <ul className="mt-2 divide-y divide-slate-100 text-sm" data-template-history>
              {history.length === 0 ? <li className="py-2 text-slate-500">Never edited.</li> : history.map((entry, index) => (
                <li key={index} className="py-2"><span className="text-slate-500">{time(entry.at)} UTC · {entry.by}</span><span className="block">{entry.changes.join("; ")}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
