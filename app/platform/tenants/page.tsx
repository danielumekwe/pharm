import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { platformCan } from "@/lib/platform/session";
import { listPlanConfigurations } from "@/lib/platform/plans";
import { openClosureCount } from "@/lib/platform/tenant-admin";
import { listTenants } from "@/lib/platform/tenants";
import { COUNTRIES, CURRENCIES, NIGERIAN_STATES, publicPlans } from "@/lib/saas/registration";

import { CreateTenantForm } from "./create-tenant-form";

export const metadata = { title: "Pharmacies · Web365 platform" };

const badge: Record<string, string> = { ACTIVE: "bg-green-100 text-green-800", SUSPENDED: "bg-rose-100 text-rose-700", CLOSED: "bg-slate-200 text-slate-700", TRIAL: "bg-amber-100 text-amber-800" };

type Search = { q?: string; status?: string; subscription?: string; plan?: string; deletion?: string };

const STATUSES = ["ACTIVE", "SUSPENDED", "CLOSED"];
const SUBSCRIPTIONS = ["TRIAL", "ACTIVE", "GRACE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"];

export default async function PlatformHome({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requirePlatformPage("tenants.view");
  const search = await searchParams;
  const pick = (value: string | undefined, allowed: string[]) => (value && allowed.includes(value) ? value : undefined);
  const [allPlans, plans] = await Promise.all([listPlanConfigurations(), publicPlans()]);
  const filters = {
    q: search.q?.slice(0, 100) || undefined,
    status: pick(search.status, STATUSES),
    subscription: pick(search.subscription, SUBSCRIPTIONS),
    plan: pick(search.plan, allPlans.map((plan) => plan.id)),
    deletion: search.deletion === "1",
  };
  const filtered = Boolean(filters.q || filters.status || filters.subscription || filters.plan || filters.deletion);
  const [tenants, closures] = await Promise.all([listTenants(filters), openClosureCount()]);
  return (
    <PlatformShell actor={actor}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pharmacies</h1>
          <p className="text-sm text-slate-600">{tenants.length} {filtered ? "matching" : "on the platform"}. Accounts, plans and usage only: pharmacy records are not visible here.</p>
          {closures ? <p className="mt-1 text-sm"><Link href="?deletion=1" className="font-semibold text-rose-700 hover:underline">{closures} closure request{closures === 1 ? "" : "s"} waiting</Link></p> : null}
        </div>
      </div>
      {platformCan(actor, "tenants.manage") ? (
        <CreateTenantForm plans={plans.map((plan) => ({ id: plan.id, name: plan.name }))} countries={Object.entries(COUNTRIES).map(([code, name]) => ({ code, name }))} currencies={[...CURRENCIES]} states={[...NIGERIAN_STATES]} />
      ) : null}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm" data-tenant-filters>
        <label className="flex-1"><span className="mb-1 block text-xs font-medium text-slate-600">Search</span><input name="q" defaultValue={filters.q ?? ""} placeholder="Name, slug or email" className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        <label><span className="mb-1 block text-xs font-medium text-slate-600">Pharmacy</span><select name="status" defaultValue={filters.status ?? ""} className="rounded-lg border border-slate-300 px-2 py-2"><option value="">Any status</option>{STATUSES.map((value) => <option key={value} value={value}>{value.toLowerCase()}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-medium text-slate-600">Subscription</span><select name="subscription" defaultValue={filters.subscription ?? ""} className="rounded-lg border border-slate-300 px-2 py-2"><option value="">Any</option>{SUBSCRIPTIONS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ").toLowerCase()}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-medium text-slate-600">Plan</span><select name="plan" defaultValue={filters.plan ?? ""} className="rounded-lg border border-slate-300 px-2 py-2"><option value="">Any plan</option>{allPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
        <label className="flex items-center gap-1 py-2"><input type="checkbox" name="deletion" value="1" defaultChecked={filters.deletion} /> Closure requested</label>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Filter</button>
        {filtered ? <Link href="/platform/tenants" className="px-2 py-2 text-green-700 hover:underline">Clear</Link> : null}
      </form>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-sm" data-tenants>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
            <tr><th className="px-4 py-2">Pharmacy</th><th className="py-2">Owner</th><th className="py-2">Plan</th><th className="py-2">Subscription</th><th className="py-2 text-right">Outlets</th><th className="py-2 text-right">Staff</th><th className="py-2">Status</th><th className="px-4 py-2">Since</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tenants.length === 0 ? <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">No pharmacies match.</td></tr> : null}
            {tenants.map((tenant) => (
              <tr key={tenant.id} data-tenant={tenant.id}>
                <td className="px-4 py-2.5"><Link href={`/platform/tenants/${tenant.id}`} className="font-medium text-green-700 hover:underline">{tenant.name}</Link>{tenant.isDemo ? <span className="ml-2 rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">demo</span> : null}{tenant.deletionRequested ? <span className="ml-2 rounded bg-rose-100 px-1.5 text-[11px] text-rose-700" data-closure-flag>closure requested</span> : null}</td>
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
