"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PaymentView } from "@/lib/billing/service";

import { RefundButton } from "./tenant-admin";
import { Empty, Panel, StatusBadge, table } from "./ui";

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
    <Panel title="Payment history and invoices" description="Payments through Paystack, with invoices and refunds." flush data-platform-payments>
      {message ? <p className="mx-5 mt-4 rounded-lg bg-slate-50 p-2 text-sm">{message}</p> : null}
      {payments.length === 0 ? <div className="px-5 py-4"><Empty>No payments yet.</Empty></div> : (
        <div className={table.wrap}>
        <table className={table.table}>
          <thead className={table.head}><tr><th className={table.th}>Date</th><th className={table.th}>Plan</th><th className={table.th}>Amount</th><th className={table.th}>Status</th><th className={table.th}>Reference</th><th className={table.th}>Invoice</th></tr></thead>
          <tbody className={table.body}>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td className={`${table.td} whitespace-nowrap`}>{(payment.paidAt ?? payment.createdAt).slice(0, 10)}</td>
                <td className={table.td}>{payment.plan} · {payment.billingCycle.toLowerCase()}<span className="block text-xs text-slate-500">{payment.purpose.toLowerCase()}</span></td>
                <td className={`${table.td} whitespace-nowrap`}>{money(payment.currency, payment.amount)}{payment.credit ? <span className="block text-xs text-slate-500">credit {money(payment.currency, payment.credit)}</span> : null}</td>
                <td className={table.td}><StatusBadge status={payment.status} />{payment.failureReason ? <span className="mt-1 block text-xs text-rose-600">{payment.failureReason}</span> : null}</td>
                <td className={`${table.td} font-mono text-xs`}>{payment.reference}</td>
                <td className={table.td}>
                  {payment.invoice ? <a href={`/api/platform/invoices/${payment.invoice.id}`} className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">{payment.invoice.number}</a> : <span className="text-slate-400">—</span>}
                  {refundable && payment.status === "SUCCESS" && payment.id in refundable ? <RefundButton paymentId={payment.id} remaining={refundable[payment.id]} currency={payment.currency} /> : null}
                  {canRecheck && payment.status === "PENDING" ? <button type="button" onClick={() => void recheck(payment.reference)} className="ml-2 rounded border border-slate-300 px-2 py-0.5 text-xs">Check with Paystack again</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {children}
    </Panel>
  );
}
