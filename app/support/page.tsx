import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { users } from "@/lib/data";
import { currentTenant } from "@/lib/db/database";
import { dateTime } from "@/lib/format";
import { CATEGORIES, pharmacyTickets, STATUSES } from "@/lib/platform/helpdesk";
import { readPlatformSetting } from "@/lib/platform/settings";
import { pageData } from "@/lib/session";

import { NewTicket } from "./ticket-forms";

export const metadata = { title: "Help and support" };

/** Contact Web365: the pharmacy's support tickets and a form to open one. */
export default async function SupportPage() {
  return pageData("dashboard.view", "/support", async (actor) => {
    const user = { id: actor.id, name: actor.name, role: actor.role, email: users.find((entry) => entry.id === actor.id)?.email ?? "" };
    const [tickets, branding] = await Promise.all([pharmacyTickets(currentTenant()!.id, user), readPlatformSetting("branding.app").catch(() => null)]);
    const contact = [branding?.value.supportEmail, branding?.value.supportPhone].filter(Boolean).join(" · ");
    return (
      <DashboardShell>
        <div className="space-y-6">
          <PageHeader eyebrow="System" title="Help and support" description={`Ask Web365 for help, report a problem or suggest a feature. Answers arrive here and by email.${contact ? ` You can also reach us at ${contact}.` : ""}`} actions={<Link href="/help" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Help articles</Link>} />
          {actor.support ? null : <Panel title="Open a ticket"><NewTicket categories={Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))} /></Panel>}
          <Panel title={`Your tickets (${tickets.length})`}>
            {tickets.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No tickets yet.</p> : (
              <ul className="divide-y divide-slate-800" data-my-tickets>
                {tickets.map((ticket) => (
                  <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm" data-ticket={ticket.number}>
                    <Link href={`/support/${ticket.id}`} className="font-medium text-white hover:underline">#{ticket.number} {ticket.subject}</Link>
                    <span className="text-slate-400">{CATEGORIES[ticket.category]} · {STATUSES[ticket.status]}{ticket.lastReplyBy === "platform" && ticket.status === "WAITING_CUSTOMER" ? " · Web365 replied" : ""} · {dateTime(ticket.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </DashboardShell>
    );
  });
}
