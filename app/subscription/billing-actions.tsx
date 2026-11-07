"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PaymentView } from "@/lib/billing/service";
import type { PublicPlan } from "@/lib/saas/registration";

type Current = { planId: string; billingCycle: string; status: string; cancelAtPeriodEnd: boolean; hasScheduledChange: boolean; paidPeriod: boolean };
type Quote =
  | { kind: "payment"; purpose: string; planName: string; subtotal: number; credit: number; amount: number; currency: string; periodStart: string; periodEnd: string }
  | { kind: "scheduled-downgrade"; planName: string; effectiveAt: string };

const money = (currency: string, value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

export function BillingActions({ plans, current }: { plans: PublicPlan[]; current: Current }) {
  const router = useRouter();
  const [cycle, setCycle] = useState<"MONTHLY" | "ANNUAL">(current.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(planId: string) {
    setSelected(planId);
    setPreview(null);
    setError("");
    try {
      setPreview(await call<Quote>(`/api/billing/quote?planId=${encodeURIComponent(planId)}&billingCycle=${cycle}`));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<{ checkoutUrl?: string; scheduled?: boolean }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ planId: selected, billingCycle: cycle }) });
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl); // Paystack's secure page; the payment is confirmed on our server afterwards
        return;
      }
      setSelected(null);
      setPreview(null);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function subscriptionAction(action: "cancel" | "resume" | "clear-scheduled-change") {
    setBusy(true);
    setError("");
    try {
      await call("/api/billing/subscription", { method: "POST", body: JSON.stringify({ action }) });
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label = (plan: PublicPlan) => {
    if (plan.id === current.planId && cycle === current.billingCycle) return current.status === "TRIAL" ? "Start paid plan" : "Renew";
    return current.status === "ACTIVE" && current.paidPeriod ? "Change to this plan" : "Choose";
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6" data-billing-actions>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Plans</h2>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(["MONTHLY", "ANNUAL"] as const).map((value) => (
            <button key={value} type="button" onClick={() => { setCycle(value); setPreview(null); setSelected(null); }} className={`rounded-md px-3 py-1 font-medium ${cycle === value ? "bg-white text-green-800 shadow-sm" : "text-slate-600"}`}>{value === "MONTHLY" ? "Monthly" : "Annual"}</button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((plan) => {
          const amount = cycle === "MONTHLY" ? plan.monthlyPrice : plan.annualPrice;
          const isCurrent = plan.id === current.planId;
          return (
            <div key={plan.id} className={`flex flex-col rounded-2xl border p-4 ${selected === plan.id ? "border-green-700 ring-2 ring-green-700/20" : isCurrent ? "border-green-300" : "border-slate-200"}`}>
              <p className="font-semibold">{plan.name}{isCurrent ? <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[11px] text-green-800">current</span> : null}</p>
              <p className="text-sm font-medium text-green-800">{amount === null ? "Price to be announced" : `${money(plan.currency, amount)} / ${cycle === "MONTHLY" ? "month" : "year"}`}</p>
              <p className="mt-2 flex-1 text-xs text-slate-600">{plan.description}</p>
              <button type="button" disabled={amount === null || busy} onClick={() => void choose(plan.id)} className="mt-3 rounded-lg bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">{label(plan)}</button>
            </div>
          );
        })}
      </div>

      {preview ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm" data-quote>
          {preview.kind === "payment" ? (
            <>
              <p><strong>{preview.planName}</strong>: {money(preview.currency, preview.subtotal)}{preview.credit > 0 ? ` − ${money(preview.currency, preview.credit)} credit for unused time` : ""} = <strong>{money(preview.currency, preview.amount)}</strong></p>
              <p className="mt-1 text-slate-700">Covers {day(preview.periodStart)} to {day(preview.periodEnd)}. You pay on Paystack&apos;s secure page; the plan is applied once Paystack confirms the payment.</p>
              <button type="button" disabled={busy} onClick={() => void confirm()} className="mt-3 rounded-lg bg-green-700 px-4 py-2 font-semibold text-white disabled:opacity-60">{busy ? "Opening payment…" : `Pay ${money(preview.currency, preview.amount)}`}</button>
            </>
          ) : (
            <>
              <p>{preview.planName} costs less than your current plan, so it starts when your paid period ends, on <strong>{day(preview.effectiveAt)}</strong>. Nothing is charged now.</p>
              <button type="button" disabled={busy} onClick={() => void confirm()} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60">Schedule the change</button>
            </>
          )}
        </div>
      ) : null}

      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-sm">
        {current.hasScheduledChange ? <button type="button" disabled={busy} onClick={() => void subscriptionAction("clear-scheduled-change")} className="rounded-lg border border-slate-300 px-3 py-1.5">Keep my current plan</button> : null}
        {current.status === "ACTIVE" && current.paidPeriod ? (
          current.cancelAtPeriodEnd
            ? <button type="button" disabled={busy} onClick={() => void subscriptionAction("resume")} className="rounded-lg border border-green-600 px-3 py-1.5 text-green-700">Keep my subscription</button>
            : <button type="button" disabled={busy} onClick={() => { if (window.confirm("Cancel at the end of the paid period? Access stops then; your data is kept.")) void subscriptionAction("cancel"); }} className="rounded-lg border border-rose-300 px-3 py-1.5 text-rose-700">Cancel subscription</button>
        ) : null}
      </div>
    </section>
  );
}

export function PaymentHistory({ payments }: { payments: PaymentView[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6" data-payment-history>
      <h2 className="text-lg font-semibold">Payment history</h2>
      {payments.length === 0 ? <p className="mt-2 text-sm text-slate-600">No payments yet.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Reference</th><th>Invoice</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((payment) => (
                <tr key={payment.id} data-payment={payment.reference} data-status={payment.status}>
                  <td className="py-2">{day(payment.paidAt ?? payment.createdAt)}</td>
                  <td>{payment.plan} · {payment.billingCycle.toLowerCase()}</td>
                  <td>{money(payment.currency, payment.amount)}</td>
                  <td>{payment.status.toLowerCase()}{payment.failureReason ? <span className="block text-xs text-rose-600">{payment.failureReason}</span> : null}</td>
                  <td className="font-mono text-xs">{payment.reference}</td>
                  <td>{payment.invoice ? <a href={`/api/billing/invoices/${payment.invoice.id}`} className="text-green-700 hover:underline">{payment.invoice.number}</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
