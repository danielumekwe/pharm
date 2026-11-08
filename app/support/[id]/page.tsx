import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { users } from "@/lib/data";
import { currentTenant } from "@/lib/db/database";
import { dateTime } from "@/lib/format";
import { CATEGORIES, pharmacyTicketThread, STATUSES } from "@/lib/platform/helpdesk";
import { pageData } from "@/lib/session";

import { TicketReplyForm } from "../ticket-forms";

export const metadata = { title: "Support ticket" };

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return pageData("dashboard.view", "/support", async (actor) => {
    const user = { id: actor.id, name: actor.name, role: actor.role, email: users.find((entry) => entry.id === actor.id)?.email ?? "" };
    const { ticket, messages } = await pharmacyTicketThread(currentTenant()!.id, user, id);
    return (
      <DashboardShell>
        <div className="space-y-6">
          <Link href="/support" className="text-sm text-green-700 hover:underline">← Help and support</Link>
          <PageHeader eyebrow={`Ticket #${ticket.number}`} title={ticket.subject} description={`${CATEGORIES[ticket.category]} · ${STATUSES[ticket.status]} · opened by ${ticket.createdBy} on ${dateTime(ticket.createdAt)}`} />
          <Panel title="Conversation">
            <ol className="space-y-3" data-ticket-thread>
              {messages.map((message) => (
                <li key={message.id} className={`rounded-xl border p-3 text-sm ${message.author_type === "platform" ? "border-green-700/40 bg-green-900/10" : "border-slate-700"}`} data-message={message.author_type}>
                  <p className="text-xs text-slate-400"><strong>{message.author_name}</strong> · {dateTime(message.created_at)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-white">{message.body}</p>
                </li>
              ))}
            </ol>
          </Panel>
          {ticket.status !== "CLOSED" && !actor.support ? <Panel title="Reply"><TicketReplyForm ticketId={ticket.id} /></Panel> : null}
        </div>
      </DashboardShell>
    );
  });
}
