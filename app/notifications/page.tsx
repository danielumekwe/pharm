import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { getStore } from "@/lib/erp/store";
import { dateTime } from "@/lib/format";
import { pageData } from "@/lib/session";

import { MarkAllRead } from "./mark-all-read";

/** Every in-app notification for the signed-in user (the header bell shows the latest 20). */
export default async function NotificationsPage() {
  return pageData("dashboard.view", "/notifications", async (actor) => {
    const items = getStore().notifications.filter((row) => row.userId === actor.id).slice(0, 300);
    const unread = items.filter((row) => !row.readAt).length;
    return (
      <DashboardShell>
        <div className="space-y-6">
          <PageHeader eyebrow="System" title="Notifications" description="Stock alerts, expiry warnings and other messages addressed to you. Opening one marks it read." actions={unread ? <MarkAllRead /> : null} />
          <Panel title={`${items.length} notification(s)`} description={`${unread} unread`}>
            {items.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {items.map((row) => (
                  <li key={row.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${row.readAt ? "opacity-70" : ""}`}>
                    <div className="min-w-0">
                      <p className="font-medium text-white">{!row.readAt ? <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-600" /> : null}{row.title}</p>
                      <p className="whitespace-pre-line text-sm text-slate-400">{row.body}</p>
                      <p className="mt-1 text-xs text-slate-500">{dateTime(row.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={row.severity} />
                      <Link href={row.link} className="text-sm font-medium text-blue-600 hover:underline">Open</Link>
                    </div>
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
