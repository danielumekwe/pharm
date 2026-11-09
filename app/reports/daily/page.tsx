import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { buildDailyReport, naira, previousBusinessDay } from "@/lib/erp/daily-report";
import { can } from "@/lib/rbac";
import { pageData } from "@/lib/session";

export const metadata = { title: "Daily pharmacy report" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The complete daily report linked from the WhatsApp summary. Sign-in and consolidated reporting rights required. */
export default async function DailyReportPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  return pageData("reports.consolidated", "/reports/daily", (actor) => {
    const day = date && DAY.test(date) ? date : previousBusinessDay();
    const report = buildDailyReport(day);
    const financial = can(actor, "reports.financial");
    const shift = (delta: number) => new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
    const stat = (label: string, value: string) => (
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"><p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-white">{value}</p></div>
    );
    return (
      <DashboardShell>
        <div className="space-y-6" data-daily-report={day}>
          <PageHeader
            eyebrow="Reports"
            title={`Daily report · ${new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`}
            description={`${report.pharmacy} · all outlets · business day in West Africa Time`}
            actions={<div className="flex gap-2 text-sm"><Link className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800" href={`?date=${shift(-1)}`}>Previous day</Link><Link className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800" href={`?date=${shift(1)}`}>Next day</Link></div>}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stat("Total sales", naira(report.totalSales))}
            {stat("Transactions", String(report.transactions))}
            {financial ? stat("Expenses recorded", naira(report.expenses)) : null}
            {financial ? stat("Gross profit", report.grossProfit === null ? "Not available" : naira(report.grossProfit)) : null}
            {stat("Low stock / out of stock", `${report.lowStock} / ${report.outOfStock}`)}
          </div>
          {financial && report.grossProfit === null ? <p className="text-xs text-slate-500">Gross profit is not shown because some items sold that day have no cost price recorded.</p> : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Sales by outlet">
              <table className="w-full text-sm"><tbody className="divide-y divide-slate-800">
                {report.byOutlet.map((row) => <tr key={row.id}><td className="py-1.5 text-slate-200">{row.name}</td><td className="text-right text-slate-400">{row.invoices} sale(s)</td><td className="text-right font-medium text-white">{naira(row.revenue)}</td></tr>)}
              </tbody></table>
            </Panel>
            <Panel title="Payment breakdown">
              <table className="w-full text-sm"><tbody className="divide-y divide-slate-800">
                {report.byMethod.length === 0 ? <tr><td className="py-1.5 text-slate-500">No payments.</td></tr> : report.byMethod.map((row) => <tr key={row.method}><td className="py-1.5 text-slate-200">{row.method}</td><td className="text-right text-slate-400">{row.share}%</td><td className="text-right font-medium text-white">{naira(row.amount)}</td></tr>)}
              </tbody></table>
            </Panel>
            <Panel title="Top-selling products">
              <table className="w-full text-sm"><tbody className="divide-y divide-slate-800">
                {report.topProducts.length === 0 ? <tr><td className="py-1.5 text-slate-500">No sales.</td></tr> : report.topProducts.map((row) => <tr key={row.name}><td className="py-1.5 text-slate-200">{row.name}</td><td className="text-right text-slate-400">{row.quantity} sold</td><td className="text-right font-medium text-white">{naira(row.revenue)}</td></tr>)}
              </tbody></table>
            </Panel>
            {financial ? (
              <Panel title="Expenses">
                <table className="w-full text-sm"><tbody className="divide-y divide-slate-800">
                  {report.expenseLines.length === 0 ? <tr><td className="py-1.5 text-slate-500">No approved or paid expenses recorded.</td></tr> : report.expenseLines.map((row) => <tr key={row.category}><td className="py-1.5 text-slate-200">{row.category}</td><td className="text-right text-slate-400">{row.count}</td><td className="text-right font-medium text-white">{naira(row.amount)}</td></tr>)}
                </tbody></table>
              </Panel>
            ) : null}
            <Panel title="Stock and expiry (now)" description="Current position, not limited to the report day.">
              <ul className="space-y-1 text-sm text-slate-200">
                <li>Low-stock products: {report.lowStock} ({report.outOfStock} out of stock)</li>
                <li>Outlets with critical shortages: {report.criticalOutlets.map((row) => `${row.name} (${row.count})`).join(", ") || "none"}</li>
                <li>Expired batches: {report.expiredBatches} — {naira(report.expiredValue)} at cost</li>
                <li>Products approaching expiry: {report.nearExpiry}</li>
              </ul>
              <Link href="/alerts" className="mt-3 inline-block text-sm font-medium text-sky-300 hover:underline">Open the alerts centre</Link>
            </Panel>
          </div>
        </div>
      </DashboardShell>
    );
  });
}
