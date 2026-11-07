import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { refundsAwaitingApproval } from "@/lib/billing/refunds";
import { requirePlatformPage } from "@/lib/platform/pages";
import { describePlatformSetting } from "@/lib/platform/settings";

import { PolicyForm } from "./policy-form";

export const metadata = { title: "Billing policy · Web365 platform" };

const money = (currency: string, value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

export default async function BillingPolicyPage() {
  const actor = await requirePlatformPage("billing.manage");
  const [setting, waiting] = await Promise.all([describePlatformSetting("subscriptions.policy"), refundsAwaitingApproval()]);
  const time = (value: string) => value.replace("T", " ").slice(0, 16);
  return (
    <PlatformShell actor={actor}>
      <h1 className="text-2xl font-bold">Billing policy</h1>
      <p className="text-sm text-slate-600">Rules for lapsed subscriptions, refunds and closed accounts. They apply to every pharmacy.</p>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <PolicyForm value={setting.value} />
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Refunds waiting for approval</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm" data-refunds-waiting>
          {waiting.length === 0 ? <li className="py-2 text-slate-500">None.</li> : waiting.map((refund) => (
            <li key={refund.id} className="py-2">
              <Link href={`/platform/tenants/${refund.tenantId}`} className="font-medium text-green-700 hover:underline">{refund.tenant}</Link>: {money(refund.currency, refund.amount)} on {refund.reference}
              <span className="block text-slate-600">Requested by {refund.requestedBy} at {time(refund.requestedAt)} UTC: {refund.reason}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Change history</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm" data-settings-history>
          {setting.history.length === 0 ? <li className="py-2 text-slate-500">Defaults in use (never changed).</li> : setting.history.map((entry, index) => (
            <li key={index} className="py-2"><span className="text-slate-500">{time(entry.at)} UTC · {entry.by}</span><span className="block">{entry.changes.join("; ")}</span></li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
