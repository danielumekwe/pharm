import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { CATEGORIES, STATUSES, staffTicketThread } from "@/lib/platform/helpdesk";
import { requirePlatformPage } from "@/lib/platform/pages";
import { listStaff } from "@/lib/platform/staff";

import { TicketControls, TicketReply } from "./ticket-actions";

export const metadata = { title: "Ticket · Web365 platform" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePlatformPage("support.tickets");
  const { id } = await params;
  const [{ ticket, messages }, staff] = await Promise.all([staffTicketThread(id), listStaff()]);
  const time = (value: string) => value.replace("T", " ").slice(0, 16);
  return (
    <PlatformShell actor={actor}>
      <Link href="/platform/tickets" className="text-sm text-green-700 hover:underline">← Support tickets</Link>
      <h1 className="mt-2 text-2xl font-bold">#{ticket.number} {ticket.subject}</h1>
      <p className="text-sm text-slate-600">{CATEGORIES[ticket.category]} · from {ticket.createdBy} &lt;{ticket.createdByEmail}&gt; at <Link href={`/platform/tenants/${ticket.tenantId}`} className="text-green-700 hover:underline">{ticket.pharmacy}</Link> · opened {time(ticket.createdAt)} UTC · {STATUSES[ticket.status]}</p>
      <TicketControls ticketId={ticket.id} status={ticket.status} priority={ticket.priority} assignedTo={ticket.assignedTo} staff={staff.filter((person) => person.status === "ACTIVE").map((person) => ({ id: person.id, name: person.name }))} />
      <ol className="mt-4 space-y-3" data-ticket-thread>
        {messages.map((message) => (
          <li key={message.id} className={`rounded-2xl border p-4 text-sm ${message.internal ? "border-amber-300 bg-amber-50" : message.author_type === "platform" ? "border-green-200 bg-green-50" : "border-slate-200 bg-white"}`} data-message={message.internal ? "internal" : message.author_type}>
            <p className="text-xs text-slate-500"><strong className="text-slate-800">{message.author_name}</strong> · {time(message.created_at)} UTC{message.internal ? " · internal note (not shown to the pharmacy)" : ""}</p>
            <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ol>
      {ticket.status !== "CLOSED" ? <TicketReply ticketId={ticket.id} /> : <p className="mt-4 text-sm text-slate-500">This ticket is closed.</p>}
    </PlatformShell>
  );
}
