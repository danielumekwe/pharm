import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { platformQuery } from "@/lib/db/database";
import { NOTIFICATION_TYPES, TYPE_KEYS } from "@/lib/notify/whatsapp/catalog";
import { listMessages } from "@/lib/notify/whatsapp/service";
import { requirePlatformPage } from "@/lib/platform/pages";

export const metadata = { title: "WhatsApp messages · Web365 platform" };

const STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "UNDELIVERED", "FAILED", "SKIPPED"];
const TONE: Record<string, string> = { DELIVERED: "text-green-700", READ: "text-green-800", SENT: "text-sky-700", FAILED: "text-rose-700", UNDELIVERED: "text-rose-700", QUEUED: "text-amber-700", SENDING: "text-amber-700", SKIPPED: "text-slate-500" };
const time = (value: unknown) => (value ? new Date(value as string).toISOString().replace("T", " ").slice(0, 16) : "—");
const select = "h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm";

export default async function WhatsAppMessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePlatformPage("settings.manage");
  const filters = await searchParams;
  const [messages, tenants] = await Promise.all([
    listMessages(filters, null),
    platformQuery<Array<{ id: string; name: string }>>((query) => query(`SELECT id, name FROM tenants ORDER BY name`)),
  ]);
  return (
    <PlatformShell actor={actor}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp messages</h1>
          <p className="text-sm text-slate-600">Every WhatsApp message the platform queued, with Zoho&apos;s message ID and delivery status. Message content is not stored.</p>
        </div>
        <Link href="/platform/settings/whatsapp" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">WhatsApp settings</Link>
      </div>
      <form className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm" data-message-filters>
        <label className="grid gap-1">Pharmacy<select name="tenant" defaultValue={filters.tenant ?? ""} className={select}><option value="">All</option>{tenants.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="grid gap-1">Recipient<input name="recipient" defaultValue={filters.recipient ?? ""} placeholder="+234…" className={select} /></label>
        <label className="grid gap-1">Status<select name="status" defaultValue={filters.status ?? ""} className={select}><option value="">All</option>{STATUSES.map((status) => <option key={status} value={status}>{status.toLowerCase()}</option>)}</select></label>
        <label className="grid gap-1">Type<select name="category" defaultValue={filters.category ?? ""} className={select}><option value="">All</option>{TYPE_KEYS.map((key) => <option key={key} value={key}>{NOTIFICATION_TYPES[key].label}</option>)}<option value="test">Test messages</option></select></label>
        <label className="grid gap-1">From<input type="date" name="from" defaultValue={filters.from ?? ""} className={select} /></label>
        <label className="grid gap-1">To<input type="date" name="to" defaultValue={filters.to ?? ""} className={select} /></label>
        <button type="submit" className="h-9 rounded-lg bg-slate-900 px-4 font-semibold text-white">Filter</button>
        <Link href="/platform/whatsapp" className="h-9 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">Clear</Link>
      </form>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4">
        <table className="w-full text-sm" data-whatsapp-log>
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Queued (UTC)</th><th>Pharmacy</th><th>Recipient</th><th>Type</th><th>Template</th><th>Message ID / client reference</th><th>Sent</th><th>Status</th><th>Read</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {messages.length === 0 ? <tr><td colSpan={9} className="py-2 text-slate-500">No messages match.</td></tr> : messages.map((row) => (
              <tr key={String(row.id)} className="align-top" data-message={String(row.status)}>
                <td className="whitespace-nowrap py-1.5">{time(row.created_at)}</td>
                <td>{(row.pharmacy as string) ?? "— (test)"}</td>
                <td className="whitespace-nowrap">{String(row.recipient_phone)}{row.recipient_name ? <span className="block text-xs text-slate-500">{String(row.recipient_name)}</span> : null}</td>
                <td>{NOTIFICATION_TYPES[row.category as keyof typeof NOTIFICATION_TYPES]?.label ?? String(row.category)}</td>
                <td>{(row.template_name as string) ?? "—"}</td>
                <td className="break-all font-mono text-xs">{(row.provider_message_id as string) ?? "—"}<span className="block text-slate-500">{String(row.client_reference)}</span></td>
                <td className="whitespace-nowrap">{time(row.sent_at)}</td>
                <td className={TONE[String(row.status)]}>{String(row.status).toLowerCase()}{Number(row.attempts) > 1 ? <span className="block text-xs text-slate-500">{String(row.attempts)} tries</span> : null}{row.failure_reason ? <span className="block text-xs text-slate-500">{String(row.failure_reason)}</span> : null}</td>
                <td className="whitespace-nowrap">{time(row.read_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Showing the latest 200 matching messages.</p>
      </div>
    </PlatformShell>
  );
}
