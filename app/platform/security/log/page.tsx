import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { securityEvents, signInLog, signInSummary } from "@/lib/platform/security";

export const metadata = { title: "Security log · Web365 platform" };

const OUTCOMES = ["success", "two_factor_required", "bad_password", "two_factor_failed", "locked", "rate_limited", "blocked_ip", "refused"];
const LABEL: Record<string, string> = { success: "signed in", two_factor_required: "password ok, code asked", bad_password: "wrong password", two_factor_failed: "wrong code", locked: "locked out", rate_limited: "too many attempts", blocked_ip: "address not allowed", refused: "refused" };
const TONE: Record<string, string> = { success: "text-green-700", bad_password: "text-amber-700", two_factor_failed: "text-amber-700", locked: "text-rose-700", rate_limited: "text-rose-700", blocked_ip: "text-rose-700" };

export default async function SecurityLogPage({ searchParams }: { searchParams: Promise<{ surface?: string; outcome?: string; who?: string }> }) {
  const actor = await requirePlatformPage("audit.view");
  const search = await searchParams;
  const filters = {
    surface: search.surface === "platform" || search.surface === "pharmacy" ? search.surface : undefined,
    outcome: OUTCOMES.includes(search.outcome ?? "") ? search.outcome : undefined,
    identifier: search.who?.slice(0, 160) || undefined,
  };
  const [summary, attempts, events] = await Promise.all([signInSummary(), signInLog(filters), securityEvents()]);
  const time = (value: string) => value.replace("T", " ").slice(0, 16);
  const tiles: [string, number, string?][] = [
    ["Platform sign-ins", summary.platformOk], ["Failed platform attempts", summary.platformFailed, summary.platformFailed ? "text-amber-700" : undefined],
    ["Pharmacy sign-ins", summary.pharmacyOk], ["Failed pharmacy attempts", summary.pharmacyFailed, summary.pharmacyFailed ? "text-amber-700" : undefined],
    ["Blocked", summary.blocked, summary.blocked ? "text-rose-700" : undefined],
  ];
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Security log</h1>
      <p className="text-sm text-slate-600">Every sign-in attempt to the platform and to pharmacies, and security changes by staff. Passwords and codes are never recorded.</p>
      <section className="mt-4 grid gap-3 sm:grid-cols-5" data-security-summary>
        {tiles.map(([label, value, tone]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`text-2xl font-bold tabular-nums ${tone ?? ""}`}>{value}</p><p className="text-xs text-slate-500">last 24 hours</p></div>)}
      </section>
      {summary.suspiciousAddresses.length ? (
        <section className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm" data-suspicious>
          <h2 className="font-semibold text-rose-800">Addresses with repeated failures (24 hours)</h2>
          <ul className="mt-1 flex flex-wrap gap-2">{summary.suspiciousAddresses.map((entry) => <li key={entry.ip} className="rounded bg-white px-2 py-0.5 font-mono text-xs">{entry.ip} · {entry.failures}</li>)}</ul>
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold">Sign-in attempts</h2>
          <form method="get" className="flex flex-wrap gap-2 text-sm" data-sign-in-filters>
            <select name="surface" defaultValue={filters.surface ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5"><option value="">Platform and pharmacies</option><option value="platform">Platform</option><option value="pharmacy">Pharmacies</option></select>
            <select name="outcome" defaultValue={filters.outcome ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5"><option value="">Any result</option>{OUTCOMES.map((value) => <option key={value} value={value}>{LABEL[value]}</option>)}</select>
            <input name="who" defaultValue={filters.identifier ?? ""} placeholder="Email or staff ID" className="rounded-lg border border-slate-300 px-2 py-1.5" />
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white">Filter</button>
            {filters.surface || filters.outcome || filters.identifier ? <Link href="?" className="px-2 py-1.5 text-green-700 hover:underline">Clear</Link> : null}
          </form>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm" data-sign-in-log>
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Time (UTC)</th><th>Where</th><th>Account</th><th>Result</th><th>Address</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {attempts.length === 0 ? <tr><td colSpan={5} className="py-2 text-slate-500">Nothing recorded.</td></tr> : attempts.map((entry, index) => (
                <tr key={index} data-attempt={entry.outcome}>
                  <td className="py-1.5 whitespace-nowrap">{time(entry.at)}</td>
                  <td>{entry.surface === "platform" ? "Control Centre" : entry.tenant ?? "Pharmacy"}</td>
                  <td className="break-all">{entry.identifier}</td>
                  <td className={TONE[entry.outcome] ?? ""}>{LABEL[entry.outcome] ?? entry.outcome}{entry.detail ? <span className="block text-xs text-slate-500">{entry.detail}</span> : null}</td>
                  <td className="font-mono text-xs">{entry.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Security events</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm" data-security-events>
          {events.length === 0 ? <li className="py-2 text-slate-500">None yet.</li> : events.map((event, index) => (
            <li key={index} className="flex gap-3 py-2"><span className="w-36 shrink-0 text-slate-500">{time(event.at)}</span><span className={event.severity === "critical" ? "text-rose-700" : event.severity === "warning" ? "text-amber-800" : "text-slate-800"}><strong>{event.actor_name}</strong> · {event.summary}</span></li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
