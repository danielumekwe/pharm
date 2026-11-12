"use client";

import { useEffect, useState } from "react";

import type { DeviceRecord } from "@/lib/offline/db";
import { offlineReports, type OfflineReports } from "@/lib/offline/reports";

const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-NG") : "—");
const naira = (value: number) => `₦${value.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

function Card({ title, asOf, children }: { title: string; asOf: string | null; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-2 text-xs font-medium text-amber-700" data-report-as-of>As of {when(asOf)} · saved on this device, not live</p>
      {children}
    </section>
  );
}

export function ReportsView({ record }: { record: DeviceRecord }) {
  const [reports, setReports] = useState<OfflineReports | null>(null);
  useEffect(() => {
    void offlineReports(record).then(setReports);
  }, [record]);
  if (!reports) return <p className="m-4 text-sm text-slate-500">Loading…</p>;
  const canSeeStock = ["stock.view", "stock.levels", "products.view"].some((permission) => record.permissions.includes(permission));
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2 print:hidden" data-offline-reports>
      {reports.sales ? (
        <Card title="Sales at this outlet (last 7 days)" asOf={reports.sales.asOf}>
          <table className="w-full text-sm">
            <tbody>
              {reports.sales.days.map((day) => (
                <tr key={day.date} className="border-t border-slate-100"><td className="py-1">{day.date}</td><td>{day.count} sale(s)</td><td className="text-right">{naira(day.total)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-600">Today by payment: {Object.entries(reports.sales.todayByMethod).map(([method, total]) => `${method} ${naira(total)}`).join(" · ") || "none yet"}</p>
          <p className="mt-1 text-xs text-slate-600">Made on this device since then: {reports.deviceSalesSince.count} sale(s), {naira(reports.deviceSalesSince.total)} ({reports.deviceSalesSince.pending} not uploaded yet).</p>
        </Card>
      ) : null}
      {canSeeStock ? (
        <>
          <Card title={`Low stock (${reports.lowStock.length})`} asOf={reports.stockAsOf}>
            <ul className="text-sm">{reports.lowStock.slice(0, 50).map((row) => <li key={row.name} className="flex justify-between border-t border-slate-100 py-1"><span>{row.name}</span><span>{row.units} / min {row.minStock} {row.baseUnit}</span></li>)}</ul>
            {!reports.lowStock.length ? <p className="text-sm text-slate-500">Nothing below its reorder level.</p> : null}
          </Card>
          <Card title={`Expiring soon (${reports.nearExpiry.length})`} asOf={reports.stockAsOf}>
            <ul className="text-sm">{reports.nearExpiry.slice(0, 50).map((row) => <li key={`${row.name}-${row.batchNumber}`} className="flex justify-between border-t border-slate-100 py-1"><span>{row.name} · {row.batchNumber}</span><span>{row.expiryDate} ({row.days} d) · {row.units}</span></li>)}</ul>
            {!reports.nearExpiry.length ? <p className="text-sm text-slate-500">No batches in the warning window.</p> : null}
          </Card>
          <Card title={`Expired, not to be sold (${reports.expired.length})`} asOf={reports.stockAsOf}>
            <ul className="text-sm">{reports.expired.slice(0, 50).map((row) => <li key={`${row.name}-${row.batchNumber}`} className="flex justify-between border-t border-slate-100 py-1"><span>{row.name} · {row.batchNumber}</span><span className="text-rose-700">{row.expiryDate} · {row.units}</span></li>)}</ul>
            {!reports.expired.length ? <p className="text-sm text-slate-500">None.</p> : null}
          </Card>
        </>
      ) : null}
      {!reports.sales && !canSeeStock ? <p className="text-sm text-slate-500">Your account has no reports.</p> : null}
    </div>
  );
}
