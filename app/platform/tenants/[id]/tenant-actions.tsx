"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, Notice } from "@/components/auth-card";

import { Badge, button, Empty, StatusBadge, table } from "./ui";

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; url?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

const field = `${inputClass} h-10`;

/**
 * Account and subscription actions (same requests as before). part="account": suspend or reactivate.
 * part="billing": trial, free days, plan and status changes, each with a required reason.
 */
export function TenantActions({
  part, tenantId, status, subscription, planId, billingCycle, currentPeriodEnd, plans, canManageAccount, canManageBilling,
}: {
  part: "account" | "billing";
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
  const [busy, setBusy] = useState(false);
  const run = async (body: unknown, done: string) => {
    setMessage(null);
    setBusy(true);
    try {
      await call(`/api/platform/tenants/${tenantId}`, "PATCH", body);
      setMessage({ tone: "success", text: done });
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
    setBusy(false);
  };
  const closed = status === "CLOSED";

  if (part === "account") {
    if (!canManageAccount) return null;
    if (closed) return <p className="text-sm text-slate-600">This pharmacy is closed. Its account and subscription can no longer be changed here.</p>;
    const suspended = status === "SUSPENDED";
    return (
      <div className="space-y-3" data-tenant-actions>
        {suspended ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Reactivating lets the pharmacy&apos;s staff sign in again straight away.</p>
            <button type="button" disabled={busy} className={button.success} onClick={() => { if (window.confirm("Reactivate this pharmacy? Its staff can sign in again at once.")) void run({ action: "reactivate" }, "Reactivated."); }}>Reactivate pharmacy</button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-600">Suspending stops every sign-in at once. The reason is shown to the pharmacy&apos;s users.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input className={field} placeholder="Reason (shown to its users)" value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} />
              <button type="button" disabled={busy} className={`${button.danger} shrink-0`} onClick={() => { if (window.confirm(`Suspend this pharmacy? Nobody there will be able to sign in until it is reactivated.${suspendReason.trim() ? `\n\nReason: ${suspendReason.trim()}` : ""}`)) void run({ action: "suspend", reason: suspendReason }, "Suspended."); }}>Suspend pharmacy</button>
            </div>
          </div>
        )}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </div>
    );
  }

  if (!canManageBilling) return null;
  if (closed) return <p className="text-sm text-slate-600">This pharmacy is closed. Its subscription can no longer be changed here.</p>;
  const block = "rounded-lg border border-slate-200 p-4";
  return (
    <div className="space-y-4" data-subscription-adjustments>
      <div>
        <label className="text-sm font-medium text-slate-800" htmlFor="adjust-reason">Reason for the change <span className="text-rose-600">*</span></label>
        <input id="adjust-reason" className={`${field} mt-1`} placeholder="Required for every change; kept in the change history" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} data-adjust-reason />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {subscription === "TRIAL" || subscription === "EXPIRED" ? (
          <div className={block}>
            <h3 className="text-sm font-semibold text-slate-900">Extend trial</h3>
            <p className="text-xs text-slate-500">Adds days to the trial (1–90).</p>
            <div className="mt-3 flex gap-2">
              <input aria-label="Days to add to the trial" type="number" min={1} max={90} className={field} value={days} onChange={(event) => setDays(Number(event.target.value))} />
              <button type="button" disabled={busy} onClick={() => void run({ action: "extend-trial", days, reason }, "Trial extended.")} className={`${button.primary} shrink-0`}>Extend trial</button>
            </div>
          </div>
        ) : null}
        {subscription && ["ACTIVE", "GRACE", "PAST_DUE"].includes(subscription) ? (
          <div className={block}>
            <h3 className="text-sm font-semibold text-slate-900">Add free days</h3>
            <p className="text-xs text-slate-500">Extends the paid period without a charge (1–366).</p>
            <div className="mt-3 flex gap-2">
              <input aria-label="Free days to add" type="number" min={1} max={366} className={field} value={paidDays} onChange={(event) => setPaidDays(Number(event.target.value))} />
              <button type="button" disabled={busy} onClick={() => void run({ action: "extend-period", days: paidDays, reason }, "Paid period extended.")} className={`${button.primary} shrink-0`}>Add days</button>
            </div>
          </div>
        ) : null}
        <div className={block}>
          <h3 className="text-sm font-semibold text-slate-900">Change plan</h3>
          <p className="text-xs text-slate-500">Plan and billing cycle.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select aria-label="Plan" className={`${field} min-w-0 flex-1`} value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
              <option value="">Choose a plan</option>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
            <select aria-label="Billing cycle" className={`${field} w-32`} value={selectedCycle} onChange={(event) => setSelectedCycle(event.target.value as "MONTHLY" | "ANNUAL")}>
              <option value="MONTHLY">Monthly</option>
              <option value="ANNUAL">Annual</option>
            </select>
            <button type="button" disabled={!selectedPlanId || busy} onClick={() => void run({ action: "change-plan", planId: selectedPlanId, billingCycle: selectedCycle, reason }, "Plan updated.")} className={button.primary}>Change plan</button>
          </div>
        </div>
        <div className={block}>
          <h3 className="text-sm font-semibold text-slate-900">Subscription status</h3>
          <p className="text-xs text-slate-500">Status and the end of the current (or grace) period.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select aria-label="Subscription status" className={`${field} w-40`} value={selectedSubscriptionStatus} onChange={(event) => setSelectedSubscriptionStatus(event.target.value)}>
              {["ACTIVE", "PAST_DUE", "GRACE", "SUSPENDED", "CANCELLED", "EXPIRED"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ").toLowerCase()}</option>)}
            </select>
            <input aria-label="Current period or grace end date" className={`${field} w-44`} type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Set the subscription to "${selectedSubscriptionStatus.replaceAll("_", " ").toLowerCase()}"?`)) void run({ action: "subscription-status", status: selectedSubscriptionStatus, currentPeriodEnd: periodEnd || null, reason }, "Subscription status updated."); }} className={button.primary}>Set status</button>
          </div>
        </div>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}

type Grant = { id: string; status: string; reason: string; minutes: number; requester: string; requestedAt: string; expiresAt: string | null };
const when = (iso: string | null) => (iso ? iso.replace("T", " ").slice(0, 16) : "—");

/** Support access: ask the pharmacy for read-only access, open approved sessions, and the request history. */
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
  const [now] = useState(() => Date.now());
  const live = grants.filter((grant) => grant.status === "APPROVED" && (!grant.expiresAt || Date.parse(grant.expiresAt) > now));
  return (
    <div className="space-y-6">
      {canRequest ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Request access</h3>
          <p className="text-xs text-slate-500">Read-only and time-limited. The pharmacy approves it, and it is recorded in both audit trails.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input className={`${field} flex-1`} aria-label="Reason for access" placeholder="Why do you need access? (the pharmacy sees this)" value={reason} onChange={(event) => setReason(event.target.value)} />
            <select aria-label="Access duration" className={`${field} sm:w-36`} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[15, 30, 60, 120, 240, 480].map((value) => <option key={value} value={value}>{value < 60 ? `${value} minutes` : `${value / 60} hour${value > 60 ? "s" : ""}`}</option>)}</select>
            <button type="button" onClick={() => void request()} className={`${button.primary} shrink-0`}>Request access</button>
          </div>
        </div>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Active sessions</h3>
        {live.length === 0 ? <div className="mt-2"><Empty>No approved access right now.</Empty></div> : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {live.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" data-grant={grant.id} data-status={grant.status}>
                <span><span className="font-medium text-slate-900">{grant.requester}</span> · {grant.minutes} min · {grant.expiresAt ? `until ${when(grant.expiresAt)} UTC` : "starts when opened"}</span>
                <button type="button" onClick={() => void open(grant.id)} className={button.secondary}>Open read-only session</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Access history</h3>
        {grants.length === 0 ? <div className="mt-2"><Empty>No support access has been requested.</Empty></div> : (
          <div className={`${table.wrap} mt-2 rounded-lg border border-slate-200`}>
            <table className={table.table}>
              <thead className={table.head}><tr><th className={table.th}>Requested (UTC)</th><th className={table.th}>By</th><th className={table.th}>Reason</th><th className={table.th}>Duration</th><th className={table.th}>Status</th><th className={table.th}>Expires</th></tr></thead>
              <tbody className={table.body}>
                {grants.map((grant) => (
                  <tr key={grant.id} data-grant={live.some((row) => row.id === grant.id) ? undefined : grant.id} data-status={grant.status}>
                    <td className={`${table.td} whitespace-nowrap`}>{when(grant.requestedAt)}</td>
                    <td className={table.td}>{grant.requester}</td>
                    <td className={table.td}>{grant.reason}</td>
                    <td className={table.td}>{grant.minutes} min</td>
                    <td className={table.td}><StatusBadge status={grant.status} /></td>
                    <td className={`${table.td} whitespace-nowrap`}>{grant.expiresAt ? when(grant.expiresAt) : <Badge>—</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
