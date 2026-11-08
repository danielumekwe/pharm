import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { CATEGORIES, PRIORITIES, STATUSES, ticketCounts, ticketQueue } from "@/lib/platform/helpdesk";
import { requirePlatformPage } from "@/lib/platform/pages";

export const metadata = { title: "Support tickets · Web365 platform" };

const TONE: Record<string, string> = { URGENT: "bg-rose-100 text-rose-800", HIGH: "bg-amber-100 text-amber-800", NORMAL: "bg-slate-100 text-slate-700", LOW: "bg-slate-50 text-slate-500" };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ status?: string; category?: string; mine?: string; q?: string }> }) {
  const actor = await requirePlatformPage("support.tickets");
  const search = await searchParams;
  const status = search.status ?? "active";
  const [tickets, counts] = await Promise.all([ticketQueue({ status, category: search.category, mine: search.mine ? actor.id : undefined, q: search.q }), ticketCounts()]);
  const time = (value: string) => value.replace("T", " ").slice(0, 16);
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Support tickets</h1>
      <p className="text-sm text-slate-600">{counts.open} open · <span className={counts.waitingOnUs ? "font-semibold text-amber-800" : ""}>{counts.waitingOnUs} waiting for Web365</span> · <span className={counts.urgent ? "font-semibold text-rose-700" : ""}>{counts.urgent} urgent</span></p>
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm" data-ticket-filters>
        <input name="q" defaultValue={search.q ?? ""} placeholder="Subject, pharmacy or #number" className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
        <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 px-2 py-2"><option value="active">Open (all active)</option>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="">Any status</option></select>
        <select name="category" defaultValue={search.category ?? ""} className="rounded-lg border border-slate-300 px-2 py-2"><option value="">Any type</option>{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <label className="flex items-center gap-1 py-2"><input type="checkbox" name="mine" value="1" defaultChecked={Boolean(search.mine)} /> Assigned to me</label>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Filter</button>
      </form>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm" data-ticket-queue>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">#</th><th>Subject</th><th>Pharmacy</th><th>Type</th><th>Priority</th><th>Status</th><th>Assigned</th><th className="px-4">Updated (UTC)</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {tickets.length === 0 ? <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">No tickets match.</td></tr> : tickets.map((ticket) => (
              <tr key={ticket.id} data-ticket={ticket.number}>
                <td className="px-4 py-2 font-mono text-xs">{ticket.number}</td>
                <td><Link href={`/platform/tickets/${ticket.id}`} className="font-medium text-green-700 hover:underline">{ticket.subject}</Link>{ticket.lastReplyBy === "pharmacy" && ["OPEN", "IN_PROGRESS"].includes(ticket.status) ? <span className="ml-1 rounded bg-amber-100 px-1.5 text-[11px] text-amber-800">needs reply</span> : null}</td>
                <td>{ticket.pharmacy}</td>
                <td>{CATEGORIES[ticket.category]}</td>
                <td><span className={`rounded px-1.5 text-xs ${TONE[ticket.priority]}`}>{PRIORITIES[ticket.priority]}</span></td>
                <td>{STATUSES[ticket.status]}</td>
                <td>{ticket.assignee ?? "—"}</td>
                <td className="px-4">{time(ticket.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PlatformShell>
  );
}
