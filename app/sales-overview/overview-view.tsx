"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CreditCard, FileSpreadsheet, FileText, Landmark, ReceiptText, RotateCcw, ShoppingBag, Tag, TrendingUp, Wallet, XCircle } from "lucide-react";
import { useState } from "react";

import { OutletBarChart, SalesAreaChart } from "@/components/charts";
import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, FormError, inputClass } from "@/components/erp/fields";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import type { SalesOverview } from "@/lib/erp/sales-overview";
import { compactMoney, money } from "@/lib/format";

type Cashier = SalesOverview["byCashier"][number];

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function SalesOverviewView({ overview, error, today, outlets }: { overview: SalesOverview | null; error: string | null; today: string; outlets: { id: string; name: string }[] }) {
  const router = useRouter();
  const meta = overview?.meta;
  const [from, setFrom] = useState(meta?.from ?? today);
  const [to, setTo] = useState(meta?.to ?? today);
  const outletParam = meta?.canPickOutlet ? (meta.scope === "consolidated" ? "all" : meta.outletIds[0]) : undefined;

  const href = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { from: meta?.from ?? today, to: meta?.to ?? today, outlet: outletParam, trend: meta?.trend ?? "daily", ...next };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    return `/sales-overview?${params.toString()}`;
  };
  const exportHref = (format: string) => `/api/sales-overview?${new URLSearchParams({ from: meta?.from ?? today, to: meta?.to ?? today, ...(outletParam ? { outlet: outletParam } : {}), trend: meta?.trend ?? "daily", format }).toString()}`;
  const monthStart = `${today.slice(0, 8)}01`;
  const presets = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: shiftDate(today, -1), to: shiftDate(today, -1) },
    { label: "Last 7 days", from: shiftDate(today, -6), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last 30 days", from: shiftDate(today, -29), to: today },
  ];
  const pill = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-emerald-500 font-medium text-emerald-950" : "text-slate-300 hover:bg-slate-800"}`;

  if (!overview || !meta) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Sales" title="Daily sales overview" description="Consolidated and per-outlet sales from the database." />
        <FormError message={error ?? "Unavailable."} />
        <Link href="/sales-overview" className="text-sm text-emerald-300 hover:underline">Back to my default view</Link>
      </div>
    );
  }

  const t = overview.totals;
  const cashierColumns: Column<Cashier>[] = [
    { key: "cashier", header: "Cashier", value: (row) => row.cashier, render: (row) => <div><p className="text-white">{row.cashier}</p><p className="text-[11px] text-slate-500">{row.outlets}</p></div> },
    { key: "tx", header: "Transactions", value: (row) => row.transactions, align: "right", render: (row) => row.transactions.toLocaleString() },
    { key: "gross", header: "Gross", value: (row) => row.gross, align: "right", render: (row) => money(row.gross) },
    { key: "disc", header: "Discounts", value: (row) => row.discounts, align: "right", render: (row) => (row.discounts ? money(row.discounts) : "—") },
    { key: "ret", header: "Returns", value: (row) => row.returns, align: "right", render: (row) => (row.returns ? <span className="text-amber-300">{money(row.returns)}</span> : "—") },
    { key: "net", header: "Net sales", value: (row) => row.net, align: "right", render: (row) => <span className="font-semibold text-white">{money(row.net)}</span> },
    { key: "basket", header: "Avg basket", value: (row) => row.avgBasket, align: "right", render: (row) => money(row.avgBasket) },
    { key: "voids", header: "Voids", value: (row) => row.voided, align: "right", render: (row) => (row.voided ? <span className="text-rose-300">{row.voided}</span> : "0") },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title={meta.scope === "own" ? "My sales" : "Daily sales overview"}
        description={`${meta.from === meta.to ? new Date(`${meta.from}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : `${meta.from} to ${meta.to}`} · ${meta.scopeLabel}. Completed transactions only; voided invoices are excluded and returns are deducted. West Africa Time.`}
        scope={meta.scopeLabel}
        actions={
          <div className="flex gap-2 print:hidden">
            <a href={exportHref("pdf")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800"><FileText className="h-4 w-4" /> PDF</a>
            <a href={exportHref("xlsx")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-500 px-3 text-sm font-medium text-emerald-950 hover:bg-emerald-400"><FileSpreadsheet className="h-4 w-4" /> Excel</a>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 print:hidden">
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => (
            <Link key={preset.label} href={href({ from: preset.from, to: preset.to })} className={pill(meta.from === preset.from && meta.to === preset.to)}>{preset.label}</Link>
          ))}
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(href({ from, to }));
          }}
        >
          <input type="date" aria-label="From" value={from} max={today} onChange={(event) => setFrom(event.target.value)} className={`${inputClass.replace("w-full ", "")} w-40`} />
          <span className="text-slate-500">to</span>
          <input type="date" aria-label="To" value={to} max={today} onChange={(event) => setTo(event.target.value)} className={`${inputClass.replace("w-full ", "")} w-40`} />
          <ActionButton type="submit" tone="secondary">Apply</ActionButton>
        </form>
        {meta.canPickOutlet ? (
          <select aria-label="Outlet" className={`${inputClass.replace("w-full ", "")} ml-auto w-auto`} value={outletParam} onChange={(event) => router.push(href({ outlet: event.target.value }))}>
            <option value="all">All outlets (consolidated)</option>
            {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
          </select>
        ) : null}
      </div>

      <StatGrid
        stats={[
          { label: "Gross sales", value: compactMoney(t.gross), note: "Before discounts, excl. VAT", icon: ShoppingBag, tone: "sky" },
          { label: "Discounts", value: compactMoney(t.discounts), note: t.gross ? `${((t.discounts / t.gross) * 100).toFixed(1)}% of gross` : "—", icon: Tag, tone: "amber" },
          { label: "Returns & refunds", value: compactMoney(t.returns), note: `${t.returnsCount} return(s) · ${money(t.refunded)} refunded`, icon: RotateCcw, tone: "rose" },
          { label: "Net sales", value: compactMoney(t.net), note: "Gross − discounts − returns", icon: TrendingUp, tone: "emerald" },
        ]}
      />
      <StatGrid
        stats={[
          { label: "Completed transactions", value: t.transactions.toLocaleString(), note: `Avg basket ${money(t.avgBasket)} · ${t.voided} voided (excluded)`, icon: ReceiptText, tone: "slate" },
          { label: "Cash payments", value: compactMoney(t.payments.netCash), note: `${money(t.payments.cash)} in · ${money(t.payments.refundCash)} refunded`, icon: Banknote, tone: "emerald" },
          { label: "Bank transfer", value: compactMoney(t.payments.netTransfer), note: `${money(t.payments.transfer)} in · ${money(t.payments.refundTransfer)} refunded`, icon: Landmark, tone: "sky" },
          { label: "POS terminal", value: compactMoney(t.payments.netPos), note: `${money(t.payments.pos)} in · ${money(t.payments.refundPos)} refunded`, icon: CreditCard, tone: "amber" },
        ]}
      />
      <div className="flex flex-wrap gap-4 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" />On account (credit / HMO): <span className="font-medium text-white">{money(t.payments.onAccount)}</span></span>
        <span>Output VAT (net of returns): <span className="font-medium text-white">{money(t.vat)}</span></span>
        <span className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-rose-300" />Voided invoices excluded: {t.voided} ({money(t.voidedValue)})</span>
        <span>Returns credited to customer accounts: {money(t.creditedToAccounts)}</span>
      </div>

      {meta.scope !== "own" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {overview.byOutlet.map((row) => (
              <Link key={row.id} href={meta.canPickOutlet ? href({ outlet: row.id }) : "#"} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm transition hover:border-emerald-500/40">
                <p className="font-semibold text-white">{row.name}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{money(row.net)}</p>
                <p className="text-xs text-slate-500">net sales · {row.transactions} transactions</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-slate-500">Gross</dt><dd className="text-right tabular-nums">{money(row.gross)}</dd>
                  <dt className="text-slate-500">Discounts</dt><dd className="text-right tabular-nums">{money(row.discounts)}</dd>
                  <dt className="text-slate-500">Returns</dt><dd className="text-right tabular-nums">{money(row.returns)}</dd>
                  <dt className="text-slate-500">Cash / Transfer / POS</dt><dd className="text-right tabular-nums">{compactMoney(row.payments.netCash)} / {compactMoney(row.payments.netTransfer)} / {compactMoney(row.payments.netPos)}</dd>
                  <dt className="text-slate-500">Voided</dt><dd className="text-right tabular-nums">{row.voided}</dd>
                </dl>
              </Link>
            ))}
          </div>
          {overview.byOutlet.length > 1 ? (
            <Panel title="Outlet comparison" description="Net sales for the selected period">
              <OutletBarChart data={overview.byOutlet.map((row) => ({ name: row.name.replace(/^Outlet \d - /, ""), value: row.net }))} />
            </Panel>
          ) : null}
        </>
      ) : null}

      <Panel
        title="Sales trend"
        description={`Net sales by ${meta.trend.replace("ly", "").replace("dai", "day")} up to ${meta.to}`}
        actions={
          <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1">
            {(["daily", "weekly", "monthly", "yearly"] as const).map((granularity) => (
              <Link key={granularity} href={href({ trend: granularity })} scroll={false} className={pill(meta.trend === granularity)}>{granularity[0].toUpperCase() + granularity.slice(1)}</Link>
            ))}
          </div>
        }
      >
        {overview.trend.length ? <SalesAreaChart data={overview.trend.map((row) => ({ month: row.label, sales: row.net }))} /> : <p className="text-sm text-slate-500">No sales in this period.</p>}
      </Panel>

      <Panel title={meta.scope === "own" ? "My performance" : "Sales by cashier"} description="Returns are attributed to the cashier who made the original sale.">
        <DataTable rows={overview.byCashier} columns={cashierColumns} rowKey={(row) => row.key} search={(row) => `${row.cashier} ${row.outlets}`} emptyMessage="No sales in this period." exportName="sales-by-cashier" dense />
      </Panel>
    </div>
  );
}
