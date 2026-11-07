import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { platformCan } from "@/lib/platform/session";
import { activePlansForAssignment } from "@/lib/platform/plans";
import { tenantDetail } from "@/lib/platform/tenants";

import { paymentsFor } from "@/lib/billing/service";

import { PlatformPayments } from "./platform-payments";
import { SupportRequests, TenantActions } from "./tenant-actions";

export const metadata = { title: "Pharmacy · Web365 platform" };

export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePlatformPage("tenants.view");
  const { id } = await params;
  const [{ tenant, audit, grants }, plans, payments] = await Promise.all([tenantDetail(id), activePlansForAssignment(), paymentsFor(id)]);
  const facts: [string, string][] = [
    ["Status", `${tenant.status.toLowerCase()}${tenant.statusReason ? ` — ${tenant.statusReason}` : ""}`],
    ["Owner", tenant.owner ? `${tenant.owner.name} <${tenant.owner.email}>` : "—"],
    ["Plan", `${tenant.plan ?? "—"} (${tenant.billingCycle?.toLowerCase() ?? "—"})`],
    ["Subscription", `${tenant.subscriptionStatus?.toLowerCase() ?? "none"}${tenant.trialEndsAt ? `, trial to ${tenant.trialEndsAt.slice(0, 10)}` : tenant.currentPeriodEnd ? `, period to ${tenant.currentPeriodEnd.slice(0, 10)}` : ""}`],
    ["Usage", `${tenant.outlets} outlet(s), ${tenant.members} staff account(s)`],
    ["Registered", tenant.createdAt.slice(0, 10)],
  ];
  return (
    <PlatformShell actor={actor}>
      <Link href="/platform" className="text-sm text-green-700 hover:underline">← Pharmacies</Link>
      <h1 className="mt-2 text-2xl font-bold" data-tenant-name>{tenant.name}</h1>
      <dl className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        {facts.map(([label, value]) => <div key={label}><dt className="text-xs uppercase tracking-[0.1em] text-slate-500">{label}</dt><dd className="font-medium text-slate-900">{value}</dd></div>)}
      </dl>
      {platformCan(actor, "tenants.manage") ? (
        <TenantActions
          tenantId={tenant.id}
          status={tenant.status}
          subscription={tenant.subscriptionStatus}
          planId={tenant.planId}
          billingCycle={tenant.billingCycle}
          currentPeriodEnd={tenant.currentPeriodEnd}
          plans={plans}
        />
      ) : null}
      <PlatformPayments payments={payments} canRecheck={platformCan(actor, "tenants.manage")} />
      <SupportRequests tenantId={tenant.id} grants={grants} canRequest={platformCan(actor, "support.request")} />
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Platform activity for this pharmacy</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {audit.length === 0 ? <li className="py-2 text-slate-500">Nothing yet.</li> : audit.map((entry, index) => (
            <li key={index} className="flex gap-3 py-2"><span className="w-36 shrink-0 text-slate-500">{entry.at.replace("T", " ").slice(0, 16)}</span><span className="text-slate-800"><strong>{entry.actor_name}</strong> · {entry.summary}</span></li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
