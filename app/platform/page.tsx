import Link from "next/link";
import { Activity, ArrowRight, ArrowUpRight, Building2, CreditCard, HeartPulse, LifeBuoy, Mail, RefreshCw, ScrollText, ShieldCheck, Users, Wallet, Zap } from "lucide-react";

import { PlatformShell } from "@/components/platform/platform-shell";
import { RevenueChart } from "@/components/platform/revenue-chart";
import { dashboardExtras, platformDashboard, type Health } from "@/lib/platform/dashboard";
import { requirePlatformPage } from "@/lib/platform/pages";
import { platformCan } from "@/lib/platform/session";

export const metadata = { title: "Control Centre · Web365 platform" };

const money = (currency: string, value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const DOT: Record<Health["status"], string> = { ok: "bg-emerald-500", warning: "bg-amber-500", error: "bg-rose-500", unknown: "bg-slate-300" };
const LABEL: Record<Health["status"], string> = { ok: "OK", warning: "Needs attention", error: "Failing", unknown: "Not checked" };
const time = (iso: string | null) => (iso ? iso.replace("T", " ").slice(0, 16) : "—");
const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);
const ago = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
};

/** A headline card. The label comes before the value in the page (for screen readers and tests); the value shows on top. */
function Kpi({ title, value, note, href, gradient, icon: Icon }: { title: string; value: string; note: string; href: string; gradient: string; icon: typeof Building2 }) {
  return (
    <Link href={href} className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 text-white shadow-lg transition hover:-translate-y-0.5`} data-stat={title}>
      <div className="flex items-start justify-between">
        <Icon className="h-7 w-7 opacity-90" />
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/20 transition group-hover:bg-white/30"><ArrowRight className="h-4 w-4" /></span>
      </div>
      <div className="mt-4 flex flex-col-reverse">
        <p className="text-sm font-medium text-white/90">{title}</p><p className="text-3xl font-bold tabular-nums">{value}</p>
      </div>
      <p className="mt-1 text-xs text-white/80">{note}</p>
    </Link>
  );
}

/** A small figure tile (label first, value second). */
function Stat({ title, value, note, href }: { title: string; value: string | number; note?: string; href?: string }) {
  const body = (
    <div className="h-full rounded-2xl border border-slate-200 bg-white p-4" data-stat={title}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {note ? <p className="text-xs text-slate-500">{note}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

function HealthRing({ percent }: { percent: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const color = percent >= 80 ? "#10b981" : percent >= 50 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center"><div><p className="text-3xl font-bold tabular-nums">{percent}%</p><p className="text-xs text-slate-500">checks passing</p></div></div>
    </div>
  );
}

const ACTIVITY_ICON = (action: string) => (action.startsWith("billing") || action.startsWith("subscription") ? CreditCard : action.startsWith("tenant") ? Building2 : action.startsWith("security") || action.startsWith("platform.login") ? ShieldCheck : action.startsWith("email") ? Mail : action.startsWith("support") ? LifeBuoy : ScrollText);

export default async function PlatformDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePlatformPage("dashboard.view");
  const { denied } = await searchParams;
  const [data, extras] = await Promise.all([platformDashboard(), dashboardExtras()]);
  const now = Date.parse(data.generatedAt);
  const t = data.tenants;
  const customers = t.total - t.demo;
  const revenue = (rows: { currency: string; amount: number }[]) => (rows.length ? rows.map((row) => money(row.currency, row.amount)).join(" + ") : money("NGN", 0));
  const passing = data.health.filter((item) => item.status === "ok").length;
  const healthPercent = Math.round((passing / data.health.length) * 100);
  const database = data.health.find((item) => item.name === "Database");
  const r = extras.revenue;
  const quick = [
    { href: "/platform/tenants", label: "Add or find a pharmacy", icon: Building2, show: platformCan(actor, "tenants.view") },
    { href: "/platform/tickets", label: "Answer support tickets", icon: LifeBuoy, show: platformCan(actor, "support.tickets") },
    { href: "/platform/settings/payments", label: "Payment gateway", icon: Wallet, show: platformCan(actor, "billing.manage") },
    { href: "/platform/settings/email", label: "Email settings", icon: Mail, show: platformCan(actor, "settings.manage") },
    { href: "/platform/security/log", label: "Security log", icon: ScrollText, show: platformCan(actor, "audit.view") },
  ].filter((action) => action.show);

  return (
    <PlatformShell actor={actor}>
      {denied ? <p role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Your platform role does not include that page.</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30"><Activity className="h-7 w-7" /></span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Control Centre</h1>
            <p className="text-sm text-slate-600">Live figures from the platform database. Revenue counts paying pharmacies only (not the demo).</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="text-right">
            <p className="flex items-center justify-end gap-2 font-medium"><span className={`h-2.5 w-2.5 rounded-full ${database?.status === "ok" ? "bg-emerald-500" : "bg-amber-500"}`} />{database?.status === "ok" ? "Database connected" : "Database slow"}</p>
            <p className="text-xs text-slate-500">Updated {time(data.generatedAt)} UTC</p>
          </div>
          <Link href="/platform" className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Refresh</Link>
        </div>
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tenant-stats>
        <Kpi title="Pharmacies" value={String(customers)} note={`${extras.pharmaciesNewThisMonth} new this month${t.demo ? ` · plus ${t.demo} demo` : ""}`} href="/platform/tenants" gradient="from-blue-600 to-blue-500" icon={Building2} />
        <Kpi title="Pharmacy users" value={String(extras.users.total)} note={`${extras.users.newThisMonth} added this month · active staff accounts`} href="/platform/tenants" gradient="from-emerald-600 to-teal-500" icon={Users} />
        <Kpi title="Revenue this month" value={money(r.currency, r.thisMonth)} note={r.change === null ? `Last month ${money(r.currency, r.lastMonth)}` : `${r.change >= 0 ? "+" : ""}${r.change}% vs last month`} href="/platform/settings/payments" gradient="from-violet-600 to-indigo-500" icon={Wallet} />
        <Kpi title="Platform health" value={`${healthPercent}%`} note={`${passing} of ${data.health.length} checks passing`} href="/platform/integrations" gradient="from-amber-500 to-orange-500" icon={HeartPulse} />
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Activity className="h-5 w-5 text-blue-600" /> Revenue overview</h2>
            <span className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600">Last 6 months · {r.currency}</span>
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums">{money(r.currency, r.total)}</p>
          <p className="text-sm text-slate-500">Successful subscription payments{r.otherCurrencies.length ? ` (also received in ${r.otherCurrencies.join(", ")}, not shown)` : ""}</p>
          <RevenueChart data={r.series} currency={r.currency} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-3" data-health>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><HeartPulse className="h-5 w-5 text-rose-500" /> Platform health</h2>
          <div className="mt-3 flex justify-center"><HealthRing percent={healthPercent} /></div>
          <ul className="mt-3 space-y-2 text-sm">
            {data.health.map((item) => (
              <li key={item.name} className="flex items-start gap-2" data-health-item={item.name} data-status={item.status} title={item.detail}>
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[item.status]}`} />
                <span className="min-w-0"><span className="font-medium">{item.name}</span> <span className="text-xs text-slate-500">· {LABEL[item.status]}</span><span className="block text-xs text-slate-500">{item.detail}</span></span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Zap className="h-5 w-5 text-amber-500" /> Quick actions</h2>
          <ul className="mt-3 space-y-2">
            {quick.map(({ href, label, icon: Icon }) => (
              <li key={href}><Link href={href} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium hover:border-blue-300 hover:bg-blue-50"><span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-white"><Icon className="h-4 w-4" /></span><span className="flex-1">{label}</span><ArrowUpRight className="h-4 w-4 text-slate-400" /></Link></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-revenue-stats>
        <Stat title="Active (paid)" value={t.active} />
        <Stat title="On trial" value={t.trial} />
        <Stat title="Suspended" value={t.suspended} />
        <Stat title="Expired or lapsed" value={t.expired + t.past_due} note={t.past_due ? `${t.past_due} past due or in grace` : undefined} />
        <Stat title="New registrations" value={t.new_30} note={`${t.new_7} in the last 7 days · 30 days`} />
        <Stat title="Monthly recurring revenue" value={data.recurring.length ? data.recurring.map((row) => money(row.currency, row.mrr)).join(" + ") : money("NGN", 0)} note={data.recurring.some((row) => row.unpriced) ? "Some paying plans have no price set" : "At current plan prices"} />
        <Stat title="Annual recurring revenue" value={data.recurring.length ? data.recurring.map((row) => money(row.currency, row.arr)).join(" + ") : money("NGN", 0)} note="MRR × 12" />
        <Stat title="Successful payments" value={data.payments30.successful.count} note={`${revenue(data.payments30.successful.byCurrency)} · 30 days`} />
        <Stat title="Failed payments" value={data.payments30.failed.count} note={`${data.payments30.renewals.count} renewals, ${data.payments30.pending.count} pending · 30 days`} />
        <Stat title="Plan mix" value={data.plans.map((plan) => `${plan.name.slice(0, 3)} ${plan.count}`).join(" · ") || "—"} note="Paying and trial pharmacies by plan" />
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-5">
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold"><Building2 className="h-5 w-5 text-blue-600" /> Recent pharmacies</h2><Link href="/platform/tenants" className="text-sm font-semibold text-blue-600 hover:underline">View all →</Link></div>
          <table className="mt-3 w-full text-sm" data-recent-pharmacies>
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1.5">Pharmacy</th><th>Status</th><th>Plan</th><th>Until</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {extras.recent.length === 0 ? <tr><td colSpan={4} className="py-4 text-center text-slate-500">No pharmacies yet.</td></tr> : extras.recent.map((row) => (
                <tr key={row.id}>
                  <td className="py-2"><Link href={`/platform/tenants/${row.id}`} className="font-medium text-blue-700 hover:underline">{row.name}</Link></td>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.status !== "ACTIVE" ? "bg-rose-100 text-rose-700" : row.sub_status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : row.sub_status === "TRIAL" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{row.status !== "ACTIVE" ? row.status.toLowerCase() : (row.sub_status ?? "none").toLowerCase().replace("_", " ")}</span></td>
                  <td>{row.plan ?? "—"}</td>
                  <td className="text-slate-600">{row.ends ? row.ends.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-4">
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold"><Activity className="h-5 w-5 text-violet-600" /> Recent activity</h2>{platformCan(actor, "audit.view") ? <Link href="/platform/audit" className="text-sm font-semibold text-blue-600 hover:underline">View all →</Link> : null}</div>
          <ul className="mt-3 space-y-3" data-recent-activity>
            {extras.activity.length === 0 ? <li className="text-sm text-slate-500">Nothing yet.</li> : extras.activity.map((entry, index) => {
              const Icon = ACTIVITY_ICON(entry.action);
              return (
                <li key={index} className="flex gap-3 text-sm">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${entry.severity === "critical" ? "bg-rose-100 text-rose-600" : entry.severity === "warning" ? "bg-amber-100 text-amber-700" : "bg-blue-50 text-blue-600"}`}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0"><span className="line-clamp-2 font-medium">{entry.summary}</span><span className="block text-xs text-slate-500">{entry.actor_name} · {ago(entry.at, now)}</span></span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-3" data-system-overview>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ScrollText className="h-5 w-5 text-slate-600" /> System overview</h2>
          <dl className="mt-3 space-y-3 text-sm">
            {[
              ["Database size", size(extras.overview.databaseBytes)],
              ["Emails sent (24 h)", `${extras.overview.emailsSent}${extras.overview.emailsFailed ? ` · ${extras.overview.emailsFailed} failed` : ""}`],
              ["Open support tickets", String(extras.overview.openTickets)],
              ["Sign-ins (24 h)", `${extras.overview.signIns}${extras.overview.failedSignIns ? ` · ${extras.overview.failedSignIns} failed` : ""}`],
              ["Last backup", extras.overview.lastBackup ? `${ago(extras.overview.lastBackup, now)}` : "None recorded"],
              ["Background jobs", data.jobs.length ? `${data.jobs[0].job} · ${time(data.jobs[0].started_at)}` : "No runs yet"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>
            ))}
          </dl>
        </div>
      </section>
    </PlatformShell>
  );
}
