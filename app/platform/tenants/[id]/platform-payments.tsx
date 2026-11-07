"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PaymentView } from "@/lib/billing/service";

import { RefundButton } from "./tenant-admin";

const money = (currency: string, value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

export function PlatformPayments({ payments, canRecheck, refundable, children }: { payments: PaymentView[]; canRecheck: boolean; refundable?: Record<string, number>; children?: React.ReactNode }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function recheck(reference: string) {
    const response = await fetch(`/api/platform/payments/${encodeURIComponent(reference)}/verify`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    setMessage(body.message ?? body.error ?? "Done.");
    router.refresh();
  }
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5" data-platform-payments>
      <h2 className="font-semibold">Payments and invoices</h2>
      {message ? <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm">{message}</p> : null}
      {payments.length === 0 ? <p className="mt-2 text-sm text-slate-500">No payments yet.</p> : (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Reference</th><th>Invoice</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td className="py-1.5">{(payment.paidAt ?? payment.createdAt).slice(0, 10)}</td>
                <td>{payment.plan} · {payment.billingCycle.toLowerCase()} · {payment.purpose.toLowerCase()}</td>
                <td>{money(payment.currency, payment.amount)}{payment.credit ? <span className="text-xs text-slate-500"> (credit {money(payment.currency, payment.credit)})</span> : null}</td>
                <td>{payment.status.toLowerCase()}{payment.failureReason ? <span className="block text-xs text-rose-600">{payment.failureReason}</span> : null}</td>
                <td className="font-mono text-xs">{payment.reference}</td>
                <td>
                  {payment.invoice ? <a href={`/api/platform/invoices/${payment.invoice.id}`} className="text-green-700 hover:underline">{payment.invoice.number}</a> : null}
                  {refundable && payment.status === "SUCCESS" && payment.id in refundable ? <RefundButton paymentId={payment.id} remaining={refundable[payment.id]} currency={payment.currency} /> : null}
                  {canRecheck && payment.status === "PENDING" ? <button type="button" onClick={() => void recheck(payment.reference)} className="ml-2 rounded border border-slate-300 px-2 py-0.5 text-xs">Check with Paystack again</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {children}
    </section>
  );
}
