import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { paymentsFor } from "@/lib/billing/service";
import { refundsFor } from "@/lib/billing/refunds";
import { adjustmentHistory } from "@/lib/platform/adjustments";
import { requirePlatformPage } from "@/lib/platform/pages";
import { activePlansForAssignment } from "@/lib/platform/plans";
import { platformCan } from "@/lib/platform/session";
import { readPlatformSetting } from "@/lib/platform/settings";
import { closureRequests, tenantActivity, tenantOutlets, tenantPeople, tenantProfile, tenantSignIns } from "@/lib/platform/tenant-admin";
import { tenantDetail } from "@/lib/platform/tenants";
import { COUNTRIES, CURRENCIES, NIGERIAN_STATES } from "@/lib/saas/registration";

import { HeaderActions, PeopleTable, StatTile, TabLink, TenantTabs } from "./console";
import { TABS, type TabId } from "./tabs";
import { PlatformPayments } from "./platform-payments";
import { ClosureRequests, ProfileEditor, RefundList } from "./tenant-admin";
import { SupportRequests, TenantActions } from "./tenant-actions";
import { Badge, Empty, Facts, Panel, StatusBadge, table } from "./ui";

export const metadata = { title: "Pharmacy · Web365 platform" };

const COMMITTED = new Set(["REQUESTED", "PENDING", "PROCESSED"]);
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const time = (iso: string | null | undefined) => (iso ? iso.replace("T", " ").slice(0, 16) : "—");
const daysLeft = (iso: string | null | undefined) => (iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000) : null);
const pretty = (value: string | null | undefined) => (value ? value.replaceAll("_", " ").toLowerCase().replace(/^./, (first) => first.toUpperCase()) : "—");
const OUTCOMES: Record<string, string> = { success: "Signed in", bad_password: "Wrong password", locked: "Locked out", rate_limited: "Too many attempts", refused: "Refused", blocked_ip: "Blocked address", two_factor_required: "Code required", two_factor_failed: "Wrong code" };

export default async function PlatformTenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const actor = await requirePlatformPage("tenants.view");
  const { id } = await params;
  const { tab } = await searchParams;
  const canManageAccount = platformCan(actor, "tenants.manage");
  const canManageBilling = platformCan(actor, "billing.manage");
  const canRequestSupport = platformCan(actor, "support.request");
  const [{ tenant, audit, grants }, plans, payments, profile, people, outlets, activity, closures, adjustments, refunds, policy, signIns] = await Promise.all([
    tenantDetail(id), activePlansForAssignment(), paymentsFor(id), tenantProfile(id), tenantPeople(id), tenantOutlets(id), tenantActivity(id),
    closureRequests(id), adjustmentHistory(id), refundsFor(id), readPlatformSetting("subscriptions.policy"), tenantSignIns(id),
  ]);
  const refundable: Record<string, number> = {};
  for (const payment of payments) {
    if (payment.status !== "SUCCESS") continue;
    const used = refunds.filter((refund) => refund.paymentId === payment.id && COMMITTED.has(refund.status)).reduce((sum, refund) => sum + refund.amount, 0);
    refundable[payment.id] = Math.max(0, Math.round((payment.amount - used) * 100) / 100);
  }

  const onTrial = tenant.subscriptionStatus === "TRIAL";
  const renewal = onTrial ? tenant.trialEndsAt : tenant.currentPeriodEnd;
  const remaining = daysLeft(renewal);
  const renewalText = renewal ? `${onTrial ? "Trial ends" : "Period ends"} ${day(renewal)}${remaining !== null ? (remaining >= 0 ? ` (in ${remaining} day${remaining === 1 ? "" : "s"})` : ` (${-remaining} day${remaining === -1 ? "" : "s"} ago)`) : ""}` : "No end date";
  const address = [profile.address, profile.state, COUNTRIES[profile.country as keyof typeof COUNTRIES] ?? profile.country].filter(Boolean).join(", ") || "—";
  const openClosure = closures.find((request) => request.status === "REQUESTED");
  const closed = tenant.status === "CLOSED";
  const initial: TabId = TABS.some(([key]) => key === tab) ? (tab as TabId) : "overview";
  const failedRecent = signIns.filter((row) => row.outcome !== "success" && row.outcome !== "two_factor_required");

  const menu: Array<{ label: string; tab: TabId; danger?: boolean }> = [
    ...(canManageBilling && !closed ? [{ label: onTrial ? "Extend trial" : "Adjust subscription", tab: "billing" as const }, { label: "Change plan", tab: "billing" as const }] : []),
    ...(canRequestSupport ? [{ label: "Request support access", tab: "support" as const }] : []),
    ...(openClosure ? [{ label: "Review closure request", tab: "security" as const, danger: true }] : []),
    ...(canManageAccount && !closed ? [{ label: tenant.status === "SUSPENDED" ? "Reactivate pharmacy" : "Suspend pharmacy", tab: "security" as const, danger: tenant.status !== "SUSPENDED" }] : []),
  ];

  const subscriptionFacts: Array<[string, React.ReactNode]> = [
    ["Current plan", tenant.plan ? <span className="font-medium">{tenant.plan}</span> : "—"],
    ["Billing cycle", pretty(tenant.billingCycle)],
    ["Status", <StatusBadge key="status" status={tenant.subscriptionStatus} />],
    [onTrial ? "Trial ends" : "Current period ends", <span key="end" className={remaining !== null && remaining <= 7 ? "font-medium text-amber-700" : ""}>{renewalText}</span>],
  ];

  const overview = (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Pharmacy information">
          <Facts rows={[
            ["Owner", tenant.owner ? <span key="owner">{tenant.owner.name}<span className="block text-slate-500">{tenant.owner.email}</span></span> : "—"],
            ["Business email", profile.businessEmail || "—"],
            ["Phone", profile.businessPhone || "—"],
            ["Address", address],
            ["Currency", profile.currency],
            ["Time zone", profile.timeZone],
          ]} />
          {canManageAccount && !closed ? (
            <ProfileEditor tenantId={tenant.id} profile={profile} countries={Object.entries(COUNTRIES).map(([code, name]) => ({ code, name }))} currencies={[...CURRENCIES]} states={[...NIGERIAN_STATES]} />
          ) : null}
        </Panel>
        <Panel title="Recent platform activity" actions={audit.length > 5 ? <TabLink tab="activity">View all</TabLink> : null}>
          {audit.length === 0 ? <Empty>No platform actions yet.</Empty> : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {audit.slice(0, 5).map((entry, index) => (
                <li key={index} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-slate-400 ring-4 ring-white" aria-hidden="true" />
                  <p className="text-sm text-slate-900">{entry.summary}</p>
                  <p className="text-xs text-slate-500">{entry.actor_name} · {time(entry.at)} UTC</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel title="Subscription" actions={<TabLink tab="billing">Manage</TabLink>}>
          <Facts rows={subscriptionFacts} />
        </Panel>
        <Panel title="Account status" actions={<TabLink tab="security">Details</TabLink>}>
          <div className="flex items-center gap-2"><StatusBadge status={tenant.status} /><span className="text-sm text-slate-600">{tenant.status === "ACTIVE" ? "Staff can sign in and use the system." : tenant.statusReason ?? ""}</span></div>
          {tenant.deletionRequested ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-inset ring-rose-600/20">The owner has asked to close this account.</p> : null}
        </Panel>
        <Panel title="Latest payments" actions={payments.length ? <TabLink tab="billing">View all</TabLink> : null}>
          {payments.length === 0 ? <Empty>No payments yet.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {payments.slice(0, 3).map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="block text-slate-900">{new Intl.NumberFormat("en-NG", { style: "currency", currency: payment.currency }).format(payment.amount)}</span><span className="text-xs text-slate-500">{day(payment.paidAt ?? payment.createdAt)} · {payment.plan}</span></span>
                  <StatusBadge status={payment.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );

  const billing = (
    <div className="space-y-6">
      <Panel title="Subscription details"><Facts rows={subscriptionFacts} /></Panel>
      {canManageBilling ? (
        <Panel title="Adjust subscription" description="Every change needs a reason and is recorded with the values before and after.">
          <TenantActions part="billing" tenantId={tenant.id} status={tenant.status} subscription={tenant.subscriptionStatus} planId={tenant.planId} billingCycle={tenant.billingCycle} currentPeriodEnd={tenant.currentPeriodEnd} plans={plans} canManageAccount={canManageAccount} canManageBilling={canManageBilling} />
        </Panel>
      ) : null}
      <PlatformPayments payments={payments} canRecheck={canManageAccount || canManageBilling} refundable={canManageBilling ? refundable : undefined}>
        <RefundList refunds={refunds} actorId={actor.id} canDecide={canManageBilling} twoPerson={policy.value.refundApproval === "two_person"} />
      </PlatformPayments>
      <Panel title="Subscription change history" description="Changes made by Web365 staff." flush>
        {adjustments.length === 0 ? <div className="px-5 py-4"><Empty>No changes by Web365.</Empty></div> : (
          <div className={table.wrap}>
            <table className={table.table} data-adjustments>
              <thead className={table.head}><tr><th className={table.th}>Date (UTC)</th><th className={table.th}>By</th><th className={table.th}>Change</th><th className={table.th}>Before → after</th><th className={table.th}>Reason</th></tr></thead>
              <tbody className={table.body}>
                {adjustments.map((entry, index) => (
                  <tr key={index}>
                    <td className={`${table.td} whitespace-nowrap`}>{time(entry.at)}</td>
                    <td className={table.td}>{entry.actor_name}</td>
                    <td className={table.td}><Badge>{pretty(entry.kind)}</Badge></td>
                    <td className={table.td}>
                      {entry.before.plan} {entry.before.billingCycle.toLowerCase()}, {entry.before.status.toLowerCase()} → {entry.after ? `${entry.after.plan} ${entry.after.billingCycle.toLowerCase()}, ${entry.after.status.toLowerCase()}` : "—"}
                      {entry.after?.currentPeriodEnd ? <span className="block text-xs text-slate-500">period to {day(entry.after.currentPeriodEnd)}</span> : entry.after?.trialEndsAt && entry.after.status === "TRIAL" ? <span className="block text-xs text-slate-500">trial to {day(entry.after.trialEndsAt)}</span> : null}
                    </td>
                    <td className={table.td}>{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );

  const usersAndOutlets = (
    <div className="space-y-6">
      <Panel title="Staff accounts" description={`${people.length} account${people.length === 1 ? "" : "s"} with access to this pharmacy.`} flush>
        <PeopleTable people={people} />
      </Panel>
      <Panel title="Outlets" description={`${outlets.length} location${outlets.length === 1 ? "" : "s"}.`} flush>
        {outlets.length === 0 ? <div className="px-5 py-4"><Empty>No outlets.</Empty></div> : (
          <div className={table.wrap}>
            <table className={table.table} data-tenant-outlets>
              <thead className={table.head}><tr><th className={table.th}>Outlet</th><th className={table.th}>Code</th><th className={table.th}>Type</th><th className={table.th}>Address</th><th className={table.th}>Status</th></tr></thead>
              <tbody className={table.body}>
                {outlets.map((outlet) => (
                  <tr key={outlet.id}>
                    <td className={`${table.td} font-medium text-slate-900`}>{outlet.name}</td>
                    <td className={`${table.td} font-mono text-xs`}>{outlet.code}</td>
                    <td className={table.td}>{pretty(outlet.type ?? "retail")}</td>
                    <td className={table.td}>{(outlet as { address?: string | null }).address || "—"}</td>
                    <td className={table.td}><StatusBadge status={outlet.status ?? "OPEN"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );

  const activityTab = (
    <div className="space-y-6">
      <Panel title="Last 30 days" description="Counts only: the pharmacy's own records are not shown here." data-tenant-activity>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><dt className="text-xs font-medium text-slate-500">Recorded actions</dt><dd className="mt-0.5 text-xl font-semibold text-slate-900">{activity.actions30d}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Sign-ins</dt><dd className="mt-0.5 text-xl font-semibold text-slate-900">{activity.signIns30d} sign-ins</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Failed sign-ins</dt><dd className={`mt-0.5 text-xl font-semibold ${activity.failedSignIns30d ? "text-amber-700" : "text-slate-900"}`}>{activity.failedSignIns30d}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Last activity</dt><dd className="mt-0.5 text-sm font-medium text-slate-900">{time(activity.lastActivityAt)} UTC</dd></div>
        </dl>
        {activity.areas.length ? <ul className="mt-4 flex flex-wrap gap-1.5">{activity.areas.map((area) => <li key={area.area}><Badge>{area.area}: {area.count}</Badge></li>)}</ul> : null}
      </Panel>
      <Panel title="Sign-in history" description="Staff sign-in attempts at this pharmacy, newest first." flush>
        {signIns.length === 0 ? <div className="px-5 py-4"><Empty>No sign-in attempts recorded.</Empty></div> : (
          <div className={table.wrap}>
            <table className={table.table} data-sign-in-history>
              <thead className={table.head}><tr><th className={table.th}>Date (UTC)</th><th className={table.th}>Account</th><th className={table.th}>Result</th><th className={table.th}>IP address</th></tr></thead>
              <tbody className={table.body}>
                {signIns.slice(0, 25).map((row, index) => (
                  <tr key={index}>
                    <td className={`${table.td} whitespace-nowrap`}>{time(row.at)}</td>
                    <td className={`${table.td} break-all`}>{row.identifier}</td>
                    <td className={table.td}><Badge tone={row.outcome === "success" ? "green" : row.outcome === "two_factor_required" ? "blue" : "red"} dot>{OUTCOMES[row.outcome] ?? pretty(row.outcome)}</Badge>{row.detail ? <span className="ml-2 text-xs text-slate-500">{row.detail}</span> : null}</td>
                    <td className={`${table.td} font-mono text-xs`}>{row.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Platform admin actions" description="What Web365 staff did on this pharmacy's account." flush>
        {audit.length === 0 ? <div className="px-5 py-4"><Empty>Nothing yet.</Empty></div> : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}><tr><th className={table.th}>Date (UTC)</th><th className={table.th}>By</th><th className={table.th}>Action</th></tr></thead>
              <tbody className={table.body}>
                {audit.map((entry, index) => (
                  <tr key={index}>
                    <td className={`${table.td} whitespace-nowrap`}>{time(entry.at)}</td>
                    <td className={`${table.td} whitespace-nowrap font-medium text-slate-900`}>{entry.actor_name}</td>
                    <td className={table.td}>{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );

  const support = (
    <Panel title="Support access" description="Read-only, time-limited access to help this pharmacy, approved by its Super Admin.">
      <SupportRequests tenantId={tenant.id} grants={grants} canRequest={canRequestSupport} />
    </Panel>
  );

  const security = (
    <div className="space-y-6">
      <Panel title="Account security">
        <Facts rows={[
          ["Account status", <span key="status" className="flex flex-wrap items-center gap-2"><StatusBadge status={tenant.status} />{tenant.statusReason ? <span className="text-slate-600">{tenant.statusReason}</span> : null}</span>],
          ["Owner sign-in email", tenant.owner?.email ?? "—"],
          ["Failed sign-ins (30 days)", <span key="failed" className={activity.failedSignIns30d ? "font-medium text-amber-700" : ""}>{activity.failedSignIns30d}</span>],
          ["Recent failed attempts", failedRecent.length ? `${failedRecent.length} in the last ${signIns.length} attempts` : "None"],
          ["Unconfirmed staff emails", String(people.filter((person) => !person.email_verified_at).length)],
          ["Last activity", `${time(activity.lastActivityAt)} UTC`],
        ]} />
      </Panel>
      {canManageAccount ? (
        <Panel title={tenant.status === "SUSPENDED" ? "Reactivate account" : "Suspend account"} description={closed ? undefined : "Takes effect immediately for every user of this pharmacy."}>
          <TenantActions part="account" tenantId={tenant.id} status={tenant.status} subscription={tenant.subscriptionStatus} planId={tenant.planId} billingCycle={tenant.billingCycle} currentPeriodEnd={tenant.currentPeriodEnd} plans={plans} canManageAccount={canManageAccount} canManageBilling={canManageBilling} />
        </Panel>
      ) : null}
      <Panel title="Account closure requests" description="Requests from the owner to close this pharmacy.">
        <ClosureRequests tenantId={tenant.id} requests={closures} canDecide={canManageAccount} retentionDays={policy.value.closedRetentionDays} />
      </Panel>
    </div>
  );

  return (
    <PlatformShell actor={actor}>
      <Link href="/platform/tenants" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"><span aria-hidden="true">←</span> Pharmacies</Link>

      <header className="mt-3 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xl font-semibold text-white" aria-hidden="true">{tenant.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase()}</div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900" data-tenant-name>{tenant.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <StatusBadge status={tenant.status} />
              {tenant.plan ? <Badge tone={onTrial ? "blue" : tenant.subscriptionStatus === "ACTIVE" ? "violet" : "amber"}>{tenant.plan}{tenant.subscriptionStatus ? ` · ${pretty(tenant.subscriptionStatus)}` : ""}</Badge> : null}
              <span>Registered {day(tenant.createdAt)}</span>
            </div>
            <p className="mt-1.5 truncate text-sm text-slate-500">{tenant.owner ? `Owner: ${tenant.owner.name} · ${tenant.owner.email}` : "No owner on record"}</p>
          </div>
        </div>
        <HeaderActions canEdit={canManageAccount && !closed} items={menu} />
      </header>

      {tenant.deletionRequested ? (
        <p role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-600/20">
          The owner has asked to close this account. <TabLink tab="security">Review the request</TabLink>
        </p>
      ) : null}

      <section aria-label="Overview" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile tab="people" label="Outlets" value={String(tenant.outlets)} detail={`${outlets.filter((outlet) => (outlet.status ?? "OPEN") !== "CLOSED").length} open`} />
        <StatTile tab="people" label="Staff accounts" value={String(tenant.members)} detail={`${people.filter((person) => person.status === "ACTIVE").length} active`} />
        <StatTile tab="billing" label="Subscription" value={tenant.plan ?? "None"} detail={renewalText} tone={remaining !== null && remaining <= 7 ? "amber" : "slate"} />
        <StatTile tab="activity" label="Recent activity" value={String(activity.actions30d)} detail={`actions · ${activity.signIns30d} sign-ins (30 days)`} />
      </section>

      <TenantTabs
        initial={initial}
        counts={{ people: people.length, support: grants.filter((grant) => grant.status === "PENDING" || grant.status === "APPROVED").length, security: openClosure ? 1 : 0 }}
        panels={{ overview, billing, people: usersAndOutlets, activity: activityTab, support, security }}
      />
    </PlatformShell>
  );
}
