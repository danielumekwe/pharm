import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { platformDashboard, type Health } from "@/lib/platform/dashboard";
import { requirePlatformPage } from "@/lib/platform/pages";

export const metadata = { title: "Control Centre · Web365 platform" };

const money = (currency: string, value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const tone: Record<Health["status"], string> = { ok: "bg-green-100 text-green-800", warning: "bg-amber-100 text-amber-800", error: "bg-rose-100 text-rose-700", unknown: "bg-slate-100 text-slate-600" };
const label: Record<Health["status"], string> = { ok: "OK", warning: "Needs attention", error: "Failing", unknown: "Not checked" };

function Stat({ title, value, note, href }: { title: string; value: string | number; note?: string; href?: string }) {
  const body = (
    <div className="rounded-2xl border border-slate-200 bg-white p-4" data-stat={title}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {note ? <p className="text-xs text-slate-500">{note}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export default async function PlatformDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePlatformPage("dashboard.view");
  const { denied } = await searchParams;
  const data = await platformDashboard();
  const t = data.tenants;
  const customers = t.total - t.demo;
  const revenue = (rows: { currency: string; amount: number }[]) => (rows.length ? rows.map((row) => money(row.currency, row.amount)).join(" + ") : money("NGN", 0));
  return (
    <PlatformShell actor={actor}>
      {denied ? <p role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Your platform role does not include that page.</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Control Centre</h1>
          <p className="text-sm text-slate-600">Live figures from the platform database. Revenue counts paying pharmacies only (not the demo).</p>
        </div>
        <p className="text-xs text-slate-500">Updated {data.generatedAt.replace("T", " ").slice(0, 16)} UTC</p>
      </div>

      <section className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-tenant-stats>
        <Stat title="Pharmacies" value={customers} note={t.demo ? `plus ${t.demo} demo` : undefined} href="/platform/tenants" />
        <Stat title="Active (paid)" value={t.active} />
        <Stat title="On trial" value={t.trial} />
        <Stat title="Suspended" value={t.suspended} />
        <Stat title="Expired or lapsed" value={t.expired + t.past_due} note={t.past_due ? `${t.past_due} past due or in grace` : undefined} />
      </section>

      <section className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-revenue-stats>
        <Stat title="Monthly recurring revenue" value={data.recurring.length ? data.recurring.map((row) => money(row.currency, row.mrr)).join(" + ") : money("NGN", 0)} note={data.recurring.some((row) => row.unpriced) ? "Some paying plans have no price set" : "At current plan prices"} />
        <Stat title="Annual recurring revenue" value={data.recurring.length ? data.recurring.map((row) => money(row.currency, row.arr)).join(" + ") : money("NGN", 0)} note="MRR × 12" />
        <Stat title="New registrations" value={t.new_30} note={`${t.new_7} in the last 7 days · 30 days`} />
        <Stat title="Successful payments" value={data.payments30.successful.count} note={`${revenue(data.payments30.successful.byCurrency)} · 30 days`} />
        <Stat title="Failed payments" value={data.payments30.failed.count} note={`${data.payments30.renewals.count} renewals, ${data.payments30.pending.count} pending · 30 days`} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2" data-health>
          <h2 className="font-semibold">Platform health</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {data.health.map((item) => (
              <li key={item.name} className="flex items-start gap-3 py-2.5 text-sm" data-health-item={item.name} data-status={item.status}>
                <span className={`mt-0.5 w-32 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold ${tone[item.status]}`}>{label[item.status]}</span>
                <span><strong>{item.name}</strong> · {item.detail}{item.checkedAt ? <span className="block text-xs text-slate-400">Checked {item.checkedAt.replace("T", " ").slice(0, 16)} UTC</span> : null}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Plan mix</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {data.plans.map((plan) => (
              <li key={plan.name} className="flex justify-between"><span>{plan.name}</span><span className="tabular-nums font-semibold">{plan.count}</span></li>
            ))}
          </ul>
          <h2 className="mt-5 font-semibold">Background jobs</h2>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {data.jobs.length === 0 ? <li>No runs recorded yet.</li> : data.jobs.map((job) => <li key={job.job}><strong>{job.job}</strong>: {job.started_at.replace("T", " ").slice(0, 16)} UTC, {job.failed} failed of {job.pharmacies}</li>)}
          </ul>
        </div>
      </section>
    </PlatformShell>
  );
}
