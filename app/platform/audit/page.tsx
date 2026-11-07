import { PlatformShell } from "@/components/platform/platform-shell";
import { platformQuery } from "@/lib/db/database";
import { requirePlatformPage } from "@/lib/platform/pages";

export const metadata = { title: "Audit log · Web365 platform" };

export default async function PlatformAuditPage() {
  const actor = await requirePlatformPage("audit.view");
  const events = await platformQuery<Array<{ at: Date; actor_name: string; actor_type: string; action: string; tenant_name: string | null; summary: string; severity: string; ip: string | null }>>((query) =>
    query(`SELECT a.at, a.actor_name, a.actor_type, a.action, t.name AS tenant_name, a.summary, a.severity, a.ip FROM platform_audit_events a LEFT JOIN tenants t ON t.id = a.tenant_id ORDER BY a.at DESC LIMIT 300`),
  );
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Platform audit log</h1>
      <p className="text-sm text-slate-600">Every platform sign-in, pharmacy change and support access step. Entries cannot be edited or deleted.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-sm" data-platform-audit>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.1em] text-slate-500"><tr><th className="px-4 py-2">When (UTC)</th><th className="py-2">Who</th><th className="py-2">Action</th><th className="py-2">Pharmacy</th><th className="px-4 py-2">Details</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {events.map((event, index) => (
              <tr key={index} className={event.severity === "warning" ? "bg-amber-50/40" : ""}>
                <td className="px-4 py-2 text-slate-500">{new Date(event.at).toISOString().replace("T", " ").slice(0, 16)}</td>
                <td className="py-2">{event.actor_name}<span className="ml-1 text-xs text-slate-400">{event.actor_type}</span></td>
                <td className="py-2 font-mono text-xs">{event.action}</td>
                <td className="py-2">{event.tenant_name ?? "—"}</td>
                <td className="px-4 py-2 text-slate-700">{event.summary}{event.ip ? <span className="ml-1 text-xs text-slate-400">({event.ip})</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PlatformShell>
  );
}
