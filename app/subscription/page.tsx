import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { withDatabaseTransaction } from "@/lib/db/database";
import { getActor } from "@/lib/session";
import { subscriptionOverview } from "@/lib/saas/subscriptions";

export const metadata = { title: "Subscription · Pharmacy" };

export default async function SubscriptionPage() {
  await connection();
  return withDatabaseTransaction(async () => {
    const actor = await getActor();
    if (!actor) redirect("/");
    const subscription = await subscriptionOverview();
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-green-800">Pharmacy subscription</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{subscription?.planName ?? "Subscription unavailable"}</h1>
          {subscription ? (
            <>
              <p className="mt-2 text-slate-700">Status: <strong>{subscription.status.toLowerCase().replaceAll("_", " ")}</strong> · {subscription.billingCycle.toLowerCase()}</p>
              {subscription.trialEndsAt ? <p className="mt-1 text-sm text-slate-600">Trial ends {subscription.trialEndsAt.slice(0, 10)}.</p> : null}
              {subscription.currentPeriodEnd ? <p className="mt-1 text-sm text-slate-600">Current period ends {subscription.currentPeriodEnd.slice(0, 10)}.</p> : null}
              <dl className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Outlets</dt><dd className="font-semibold">{subscription.outletCount}{subscription.maxOutlets === null ? " · limit not set" : ` / ${subscription.maxOutlets}`}</dd></div>
                <div><dt className="text-slate-500">Staff accounts</dt><dd className="font-semibold">{subscription.staffCount}{subscription.maxStaffAccounts === null ? " · limit not set" : ` / ${subscription.maxStaffAccounts}`}</dd></div>
              </dl>
              {subscription.problem ? <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{subscription.problem}</p> : null}
            </>
          ) : (
            <p className="mt-4 text-sm text-slate-700">This pharmacy has no subscription attached. Contact Web365 to restore access.</p>
          )}
          <p className="mt-4 text-sm text-slate-600">To change plans or resolve a billing issue, contact Web365.</p>
          <Link href="/" className="mt-5 inline-block rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">Return to sign in</Link>
        </section>
      </main>
    );
  });
}
