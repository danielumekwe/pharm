import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { paymentsFor } from "@/lib/billing/service";
import { refundsFor } from "@/lib/billing/refunds";
import { adjustmentHistory } from "@/lib/platform/adjustments";
import { requirePlatformPage } from "@/lib/platform/pages";
import { activePlansForAssignment } from "@/lib/platform/plans";
import { platformCan } from "@/lib/platform/session";
import { readPlatformSetting } from "@/lib/platform/settings";
import { closureRequests, tenantActivity, tenantOutlets, tenantPeople, tenantProfile } from "@/lib/platform/tenant-admin";
import { tenantDetail } from "@/lib/platform/tenants";
import { COUNTRIES, CURRENCIES, NIGERIAN_STATES } from "@/lib/saas/registration";

import { PlatformPayments } from "./platform-payments";
import { ClosureRequests, ProfileEditor, RefundList } from "./tenant-admin";
import { SupportRequests, TenantActions } from "./tenant-actions";

export const metadata = { title: "Pharmacy · Web365 platform" };

const COMMITTED = new Set(["REQUESTED", "PENDING", "PROCESSED"]);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const time = (iso: string | null) => (iso ? iso.replace("T", " ").slice(0, 16) : "—");

export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePlatformPage("tenants.view");
  const { id } = await params;
  const canManageAccount = platformCan(actor, "tenants.manage");
  const canManageBilling = platformCan(actor, "billing.manage");
  const [{ tenant, audit, grants }, plans, payments, profile, people, outlets, activity, closures, adjustments, refunds, policy] = await Promise.all([
    tenantDetail(id), activePlansForAssignment(), paymentsFor(id), tenantProfile(id), tenantPeople(id), tenantOutlets(id), tenantActivity(id),
    closureRequests(id), adjustmentHistory(id), refundsFor(id), readPlatformSetting("subscriptions.policy"),
  ]);
  const refundable: Record<string, number> = {};
  for (const payment of payments) {
    if (payment.status !== "SUCCESS") continue;
    const used = refunds.filter((refund) => refund.paymentId === payment.id && COMMITTED.has(refund.status)).reduce((sum, refund) => sum + refund.amount, 0);
    refundable[payment.id] = Math.max(0, Math.round((payment.amount - used) * 100) / 100);
  }
  const facts: [string, string][] = [
    ["Status", `${tenant.status.toLowerCase()}${tenant.statusReason ? ` — ${tenant.statusReason}` : ""}`],
    ["Owner", tenant.owner ? `${tenant.owner.name} <${tenant.owner.email}>` : "—"],
    ["Plan", `${tenant.plan ?? "—"} (${tenant.billingCycle?.toLowerCase() ?? "—"})`],
    ["Subscription", `${tenant.subscriptionStatus?.toLowerCase() ?? "none"}${tenant.trialEndsAt && tenant.subscriptionStatus === "TRIAL" ? `, trial to ${day(tenant.trialEndsAt)}` : tenant.currentPeriodEnd ? `, period to ${day(tenant.currentPeriodEnd)}` : ""}`],
    ["Usage", `${tenant.outlets} outlet(s), ${tenant.members} staff account(s)`],
    ["Registered", day(tenant.createdAt)],
    ["Business email", profile.businessEmail || "—"],
    ["Phone", profile.businessPhone || "—"],
    ["Address", [profile.address, profile.state, COUNTRIES[profile.country as keyof typeof COUNTRIES] ?? profile.country].filter(Boolean).join(", ") || "—"],
    ["Currency and time zone", `${profile.currency} · ${profile.timeZone}`],
  ];
  return (
    <PlatformShell actor={actor}>
      <Link href="/platform/tenants" className="text-sm text-green-700 hover:underline">← Pharmacies</Link>
      <h1 className="mt-2 text-2xl font-bold" data-tenant-name>{tenant.name}</h1>
      {tenant.deletionRequested ? <p role="alert" className="mt-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">The owner has asked to close this account. See the request below.</p> : null}

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          {facts.map(([label, value]) => <div key={label}><dt className="text-xs uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="font-medium text-slate-900">{value}</dd></div>)}
        </dl>
        {canManageAccount && tenant.status !== "CLOSED" ? (
          <ProfileEditor tenantId={tenant.id} profile={profile} countries={Object.entries(COUNTRIES).map(([code, name]) => ({ code, name }))} currencies={[...CURRENCIES]} states={[...NIGERIAN_STATES]} />
        ) : null}
      </section>

      {canManageAccount || canManageBilling ? (
        <TenantActions
          tenantId={tenant.id} status={tenant.status} subscription={tenant.subscriptionStatus} planId={tenant.planId} billingCycle={tenant.billingCycle}
          currentPeriodEnd={tenant.currentPeriodEnd} plans={plans} canManageAccount={canManageAccount} canManageBilling={canManageBilling}
        />
      ) : null}

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <h2 className="font-semibold">People ({people.length})</h2>
          <table className="mt-2 w-full text-sm" data-tenant-people>
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((person) => (
                <tr key={person.user_id}>
                  <td className="py-1.5">{person.name}</td>
                  <td className="break-all">{person.email}{person.email_verified_at ? null : <span className="ml-1 text-xs text-amber-700">unconfirmed</span>}</td>
                  <td>{person.role.replaceAll("_", " ").toLowerCase()}</td>
                  <td>{person.status.toLowerCase()}</td>
                  <td>{time(person.last_login)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" data-tenant-activity>
            <h2 className="font-semibold">Activity (last 30 days)</h2>
            <p className="mt-1">{activity.actions30d} recorded actions · {activity.signIns30d} sign-ins · <span className={activity.failedSignIns30d ? "text-amber-700" : ""}>{activity.failedSignIns30d} failed sign-ins</span></p>
            <p className="text-slate-600">Last activity: {time(activity.lastActivityAt)} UTC</p>
            {activity.areas.length ? <ul className="mt-2 flex flex-wrap gap-1">{activity.areas.map((area) => <li key={area.area} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{area.area}: {area.count}</li>)}</ul> : null}
            <p className="mt-2 text-xs text-slate-500">Counts only: the pharmacy&apos;s records are not shown here.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
            <h2 className="font-semibold">Outlets ({outlets.length})</h2>
            <ul className="mt-2 divide-y divide-slate-100" data-tenant-outlets>
              {outlets.map((outlet) => <li key={outlet.id} className="py-1.5"><span className="font-medium">{outlet.name}</span> <span className="text-xs text-slate-500">{outlet.code}{outlet.type ? ` · ${outlet.type.toLowerCase()}` : ""} · {(outlet.status ?? "open").toLowerCase()}</span></li>)}
            </ul>
          </div>
        </div>
      </section>

      <PlatformPayments payments={payments} canRecheck={canManageAccount || canManageBilling} refundable={canManageBilling ? refundable : undefined}>
        <RefundList refunds={refunds} actorId={actor.id} canDecide={canManageBilling} twoPerson={policy.value.refundApproval === "two_person"} />
      </PlatformPayments>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Subscription changes by Web365</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm" data-adjustments>
          {adjustments.length === 0 ? <li className="py-2 text-slate-500">None.</li> : adjustments.map((entry, index) => (
            <li key={index} className="py-2">
              <span className="text-slate-500">{time(entry.at)} UTC · {entry.actor_name} · {entry.kind}</span>
              <span className="block">{entry.before.plan} {entry.before.billingCycle.toLowerCase()}, {entry.before.status.toLowerCase()} → {entry.after ? `${entry.after.plan} ${entry.after.billingCycle.toLowerCase()}, ${entry.after.status.toLowerCase()}` : "—"}{entry.after?.currentPeriodEnd ? ` (period to ${day(entry.after.currentPeriodEnd)})` : entry.after?.trialEndsAt && entry.after.status === "TRIAL" ? ` (trial to ${day(entry.after.trialEndsAt)})` : ""}</span>
              <span className="block text-slate-600">Reason: {entry.reason}</span>
            </li>
          ))}
        </ul>
      </section>

      <ClosureRequests tenantId={tenant.id} requests={closures} canDecide={canManageAccount} retentionDays={policy.value.closedRetentionDays} />
      <SupportRequests tenantId={tenant.id} grants={grants} canRequest={platformCan(actor, "support.request")} />
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Platform activity for this pharmacy</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {audit.length === 0 ? <li className="py-2 text-slate-500">Nothing yet.</li> : audit.map((entry, index) => (
            <li key={index} className="flex gap-3 py-2"><span className="w-36 shrink-0 text-slate-500">{time(entry.at)}</span><span className="text-slate-800"><strong>{entry.actor_name}</strong> · {entry.summary}</span></li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
