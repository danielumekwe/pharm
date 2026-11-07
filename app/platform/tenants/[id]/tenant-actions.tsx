"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, Notice } from "@/components/auth-card";

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; url?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

export function TenantActions({
  tenantId, status, subscription, planId, billingCycle, currentPeriodEnd, plans, canManageAccount, canManageBilling,
}: {
  tenantId: string;
  status: string;
  subscription: string | null;
  planId: string | null;
  billingCycle: string | null;
  currentPeriodEnd: string | null;
  plans: { id: string; name: string }[];
  canManageAccount: boolean;
  canManageBilling: boolean;
}) {
  const router = useRouter();
  const [suspendReason, setSuspendReason] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(14);
  const [paidDays, setPaidDays] = useState(7);
  const [selectedPlanId, setSelectedPlanId] = useState(planId ?? "");
  const [selectedCycle, setSelectedCycle] = useState<"MONTHLY" | "ANNUAL">(billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY");
  const [selectedSubscriptionStatus, setSelectedSubscriptionStatus] = useState(
    subscription && ["ACTIVE", "PAST_DUE", "GRACE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(subscription) ? subscription : "ACTIVE",
  );
  const [periodEnd, setPeriodEnd] = useState(currentPeriodEnd?.slice(0, 10) ?? "");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = async (body: unknown, done: string) => {
    setMessage(null);
    try {
      await call(`/api/platform/tenants/${tenantId}`, "PATCH", body);
      setMessage({ tone: "success", text: done });
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  };
  const button = "shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
  const closed = status === "CLOSED";
  return (
    <section className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5" data-tenant-actions>
      {canManageAccount && !closed ? (
        <div>
          <h2 className="font-semibold">{status === "SUSPENDED" ? "Reactivate" : "Suspend"} pharmacy</h2>
          {status === "SUSPENDED" ? (
            <button type="button" onClick={() => void run({ action: "reactivate" }, "Reactivated.")} className="mt-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white">Reactivate</button>
          ) : (
            <div className="mt-2 flex gap-2">
              <input className={inputClass} placeholder="Reason (shown to its users)" value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} />
              <button type="button" onClick={() => void run({ action: "suspend", reason: suspendReason }, "Suspended.")} className="shrink-0 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white">Suspend</button>
            </div>
          )}
        </div>
      ) : null}
      {canManageBilling && !closed ? (
        <div className="border-t border-slate-100 pt-4" data-subscription-adjustments>
          <h2 className="font-semibold">Adjust the subscription</h2>
          <p className="text-sm text-slate-600">Every change needs a reason. It is kept with the values before and after, below.</p>
          <input className={`${inputClass} mt-2`} placeholder="Reason for the change (required)" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} data-adjust-reason />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {subscription === "TRIAL" || subscription === "EXPIRED" ? (
              <div>
                <h3 className="text-sm font-semibold">Extend trial (days)</h3>
                <div className="mt-1 flex gap-2">
                  <input type="number" min={1} max={90} className={inputClass} value={days} onChange={(event) => setDays(Number(event.target.value))} />
                  <button type="button" onClick={() => void run({ action: "extend-trial", days, reason }, "Trial extended.")} className={button}>Extend</button>
                </div>
              </div>
            ) : null}
            {subscription && ["ACTIVE", "GRACE", "PAST_DUE"].includes(subscription) ? (
              <div>
                <h3 className="text-sm font-semibold">Add free days to the paid period</h3>
                <div className="mt-1 flex gap-2">
                  <input type="number" min={1} max={366} className={inputClass} value={paidDays} onChange={(event) => setPaidDays(Number(event.target.value))} />
                  <button type="button" onClick={() => void run({ action: "extend-period", days: paidDays, reason }, "Paid period extended.")} className={button}>Add days</button>
                </div>
              </div>
            ) : null}
            <div>
              <h3 className="text-sm font-semibold">Plan</h3>
              <div className="mt-1 flex flex-wrap gap-2">
                <select className={inputClass} value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
                  <option value="">Choose a plan</option>
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
                <select className={inputClass} value={selectedCycle} onChange={(event) => setSelectedCycle(event.target.value as "MONTHLY" | "ANNUAL")}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="ANNUAL">Annual</option>
                </select>
                <button type="button" disabled={!selectedPlanId} onClick={() => void run({ action: "change-plan", planId: selectedPlanId, billingCycle: selectedCycle, reason }, "Plan updated.")} className={button}>Change plan</button>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Status and period end</h3>
              <div className="mt-1 flex flex-wrap gap-2">
                <select className={inputClass} value={selectedSubscriptionStatus} onChange={(event) => setSelectedSubscriptionStatus(event.target.value)}>
                  {["ACTIVE", "PAST_DUE", "GRACE", "SUSPENDED", "CANCELLED", "EXPIRED"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ").toLowerCase()}</option>)}
                </select>
                <input aria-label="Current period or grace end date" className={inputClass} type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
                <button type="button" onClick={() => void run({ action: "subscription-status", status: selectedSubscriptionStatus, currentPeriodEnd: periodEnd || null, reason }, "Subscription status updated.")} className={button}>Set status</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {closed ? <p className="text-sm text-slate-600">This pharmacy is closed. Its account and subscription can no longer be changed here.</p> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </section>
  );
}

type Grant = { id: string; status: string; reason: string; minutes: number; requester: string; requestedAt: string; expiresAt: string | null };

export function SupportRequests({ tenantId, grants, canRequest }: { tenantId: string; grants: Grant[]; canRequest: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function request() {
    setMessage(null);
    try {
      await call(`/api/platform/tenants/${tenantId}/support`, "POST", { reason, minutes });
      setMessage({ tone: "success", text: "Asked. The pharmacy's Super Admin decides; you can open the session once it is approved." });
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  }
  async function open(grantId: string) {
    try {
      const { url } = await call(`/api/platform/support/${grantId}/open`, "POST");
      window.location.assign(url ?? "/dashboard");
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  }
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Support access</h2>
      <p className="text-sm text-slate-600">Read-only, time-limited, approved by the pharmacy, and recorded in both audit trails.</p>
      {canRequest ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className={`${inputClass} flex-1`} placeholder="Why do you need access? (the pharmacy sees this)" value={reason} onChange={(event) => setReason(event.target.value)} />
          <select className={`${inputClass} w-36`} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[15, 30, 60, 120, 240, 480].map((value) => <option key={value} value={value}>{value} min</option>)}</select>
          <button type="button" onClick={() => void request()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Ask for access</button>
        </div>
      ) : null}
      {message ? <div className="mt-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {grants.map((grant) => (
          <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-grant={grant.id} data-status={grant.status}>
            <span><strong>{grant.requester}</strong> · {grant.minutes} min · “{grant.reason}” · <span className="uppercase text-xs font-semibold">{grant.status}</span>{grant.expiresAt ? ` · until ${grant.expiresAt.replace("T", " ").slice(0, 16)} UTC` : ""}</span>
            {grant.status === "APPROVED" ? <button type="button" onClick={() => void open(grant.id)} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950">Open read-only session</button> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
