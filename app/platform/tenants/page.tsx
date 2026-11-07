import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { platformCan } from "@/lib/platform/session";
import { listTenants } from "@/lib/platform/tenants";
import { COUNTRIES, CURRENCIES, NIGERIAN_STATES, publicPlans } from "@/lib/saas/registration";

import { CreateTenantForm } from "./create-tenant-form";

export const metadata = { title: "Pharmacies · Web365 platform" };

const badge: Record<string, string> = { ACTIVE: "bg-green-100 text-green-800", SUSPENDED: "bg-rose-100 text-rose-700", CLOSED: "bg-slate-200 text-slate-700", TRIAL: "bg-amber-100 text-amber-800" };

export default async function PlatformHome() {
  const actor = await requirePlatformPage("tenants.view");
  const [tenants, plans] = await Promise.all([listTenants(), publicPlans()]);
  return (
    <PlatformShell actor={actor}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pharmacies</h1>
          <p className="text-sm text-slate-600">{tenants.length} on the platform. Accounts, plans and usage only: pharmacy records are not visible here.</p>
        </div>
      </div>
      {platformCan(actor, "tenants.manage") ? (
        <CreateTenantForm plans={plans.map((plan) => ({ id: plan.id, name: plan.name }))} countries={Object.entries(COUNTRIES).map(([code, name]) => ({ code, name }))} currencies={[...CURRENCIES]} states={[...NIGERIAN_STATES]} />
      ) : null}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-sm" data-tenants>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
            <tr><th className="px-4 py-2">Pharmacy</th><th className="py-2">Owner</th><th className="py-2">Plan</th><th className="py-2">Subscription</th><th className="py-2 text-right">Outlets</th><th className="py-2 text-right">Staff</th><th className="py-2">Status</th><th className="px-4 py-2">Since</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tenants.map((tenant) => (
              <tr key={tenant.id} data-tenant={tenant.id}>
                <td className="px-4 py-2.5"><Link href={`/platform/tenants/${tenant.id}`} className="font-medium text-green-700 hover:underline">{tenant.name}</Link>{tenant.isDemo ? <span className="ml-2 rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">demo</span> : null}</td>
                <td className="py-2.5 text-slate-700">{tenant.owner?.email ?? "—"}</td>
                <td className="py-2.5">{tenant.plan ?? "—"}</td>
                <td className="py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge[tenant.subscriptionStatus ?? ""] ?? "bg-slate-100 text-slate-700"}`}>{tenant.subscriptionStatus?.toLowerCase() ?? "none"}</span>{tenant.trialEndsAt && tenant.subscriptionStatus === "TRIAL" ? <span className="ml-1 text-xs text-slate-500">to {tenant.trialEndsAt.slice(0, 10)}</span> : null}</td>
                <td className="py-2.5 text-right tabular-nums">{tenant.outlets}</td>
                <td className="py-2.5 text-right tabular-nums">{tenant.members}</td>
                <td className="py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge[tenant.status] ?? ""}`}>{tenant.status.toLowerCase()}</span></td>
                <td className="px-4 py-2.5 text-slate-500">{tenant.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PlatformShell>
  );
}
