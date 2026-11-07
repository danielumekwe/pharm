import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { paymentsFor } from "@/lib/billing/service";
import { currentTenant, withDatabaseTransaction } from "@/lib/db/database";
import { getActor } from "@/lib/session";
import { publicPlans } from "@/lib/saas/registration";
import { subscriptionOverview } from "@/lib/saas/subscriptions";

import { BillingActions, PaymentHistory } from "./billing-actions";

export const metadata = { title: "Subscription and billing" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—");

/** The pharmacy's account page. Reachable even when the subscription has lapsed (that is how it is renewed). */
export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { paid } = await searchParams;
  return withDatabaseTransaction(async () => {
    const actor = await getActor();
    if (!actor?.tenantId) redirect("/");
    const [subscription, plans, payments] = await Promise.all([subscriptionOverview(), publicPlans(), paymentsFor(actor.tenantId)]);
    const canManage = actor.permissions.includes("settings.manage") && !actor.support;
    const canSeeBilling = canManage || actor.permissions.includes("finance.view");
    const pharmacy = currentTenant()?.name ?? "Your pharmacy";

    return (
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-green-800">{pharmacy}</p>
            <h1 className="text-2xl font-bold">Subscription and billing</h1>
          </div>
          {subscription && !subscription.problem ? <Link href="/dashboard" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Back to the dashboard</Link> : null}
        </div>

        {paid === "1" ? <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-900">Payment confirmed. Thank you.</p> : null}
        {subscription?.problem ? <p role="alert" data-subscription-problem className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">{subscription.problem}</p> : null}

        {subscription ? (
          <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-3" data-subscription-status={subscription.status}>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Plan</p><p className="text-lg font-semibold">{subscription.planName} <span className="text-sm font-normal text-slate-500">· {subscription.billingCycle.toLowerCase()}</span></p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Status</p><p className="text-lg font-semibold">{subscription.status.toLowerCase().replaceAll("_", " ")}{subscription.isDemo ? " (complimentary demo)" : ""}</p></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">{subscription.status === "TRIAL" ? "Trial ends" : subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"}</p>
              <p className="text-lg font-semibold">{day(subscription.status === "TRIAL" ? subscription.trialEndsAt : subscription.currentPeriodEnd)}</p>
            </div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Outlets used</p><p className="font-semibold">{subscription.outletCount}{subscription.maxOutlets === null ? " (no limit set)" : ` of ${subscription.maxOutlets}`}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Staff accounts used</p><p className="font-semibold">{subscription.staffCount}{subscription.maxStaffAccounts === null ? " (no limit set)" : ` of ${subscription.maxStaffAccounts}`}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Payment card</p><p className="font-semibold">{subscription.cardLabel ?? "None saved"}</p></div>
            {subscription.scheduledChange ? <p className="sm:col-span-3 rounded-lg bg-slate-50 p-3 text-sm">Changing to <strong>{subscription.scheduledChange.planName}</strong> ({subscription.scheduledChange.billingCycle?.toLowerCase()}) when the current period ends.</p> : null}
            {subscription.cancelAtPeriodEnd ? <p className="sm:col-span-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Cancelled: access continues until {day(subscription.currentPeriodEnd)}, then stops. Your data is kept.</p> : null}
          </section>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-white p-6">This pharmacy has no subscription attached. Contact Web365 to restore access.</p>
        )}

        {subscription && canManage && !subscription.isDemo ? (
          <BillingActions
            plans={plans}
            current={{ planId: subscription.planId, billingCycle: subscription.billingCycle, status: subscription.status, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, hasScheduledChange: Boolean(subscription.scheduledChange), paidPeriod: Boolean(subscription.currentPeriodEnd) }}
          />
        ) : subscription && !canManage ? (
          <p className="text-sm text-slate-600">Only the Pharmacy Super Admin can change the plan or pay.</p>
        ) : null}

        {canSeeBilling ? <PaymentHistory payments={payments} /> : null}

        {subscription?.problem ? <Link href="/" className="inline-block text-sm text-green-700 hover:underline">Back to sign in</Link> : null}
      </main>
    );
  });
}
