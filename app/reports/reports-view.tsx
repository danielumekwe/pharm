"use client";

import Link from "next/link";
import { Banknote, FileSpreadsheet, Landmark, PiggyBank, Printer, Receipt, TrendingDown, TrendingUp } from "lucide-react";

import { OutletBarChart, SalesAreaChart } from "@/components/charts";
import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton } from "@/components/erp/fields";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import type { Report } from "@/lib/erp/reports";
import { compactMoney, dateTime, money, shortDate } from "@/lib/format";

type Row<K extends keyof Report> = Report[K] extends (infer T)[] ? T : never;

const pctCell = (value: number, warnBelow?: number) => (
  <span className={warnBelow !== undefined && value < warnBelow ? "text-amber-300" : ""}>{value.toFixed(1)}%</span>
);

export function ReportsView({ report, periods, outlets }: { report: Report; periods: number[]; outlets: { id: string; name: string }[] }) {
  const { meta, summary: s } = report;
  const query = (next: { days?: number; outlet?: string | null }) => {
    const params = new URLSearchParams();
    params.set("days", String(next.days ?? meta.days));
    const outlet = next.outlet === undefined ? meta.outletId : next.outlet;
    if (!meta.locked) params.set("outlet", outlet ?? "all");
    return `?${params.toString()}`;
  };

  const { sales: canSales, inventory: canInventory, financial: canFinancial } = meta.sections;
  const showSales = canSales || canFinancial;
  const financialKeys = new Set(["cost", "gp", "margin"]);
  const itemColumnsAll: Column<Row<"byItem">>[] = [
    { key: "name", header: "Item", value: (r) => r.name, render: (r) => <span className="text-white">{r.name}</span> },
    { key: "qty", header: "Units", value: (r) => r.quantity, align: "right", render: (r) => r.quantity.toLocaleString() },
    { key: "rev", header: "Net revenue", value: (r) => r.revenue, align: "right", render: (r) => money(r.revenue) },
    { key: "cost", header: "Cost", value: (r) => r.cost, align: "right", render: (r) => money(r.cost) },
    { key: "gp", header: "Gross profit", value: (r) => r.grossProfit, align: "right", render: (r) => <span className="font-medium text-white">{money(r.grossProfit)}</span> },
    { key: "margin", header: "Margin", value: (r) => r.margin, align: "right", render: (r) => pctCell(r.margin, 20) },
    { key: "share", header: "Share", value: (r) => r.share, align: "right", render: (r) => pctCell(r.share) },
  ];
  const itemColumns = canFinancial ? itemColumnsAll : itemColumnsAll.filter((column) => !financialKeys.has(column.key));
  const cashierColumns: Column<Row<"byCashier">>[] = [
    { key: "c", header: "Cashier", value: (r) => r.cashier, render: (r) => <span className="text-white">{r.cashier}</span> },
    { key: "i", header: "Invoices", value: (r) => r.invoices, align: "right", render: (r) => r.invoices },
    { key: "u", header: "Units", value: (r) => r.items, align: "right", render: (r) => r.items.toLocaleString() },
    { key: "rev", header: "Revenue", value: (r) => r.revenue, align: "right", render: (r) => money(r.revenue) },
    { key: "b", header: "Avg basket", value: (r) => r.avgBasket, align: "right", render: (r) => money(r.avgBasket) },
    { key: "v", header: "Voids", value: (r) => r.voids, align: "right", render: (r) => (r.voids ? <span className="text-amber-300">{r.voids}</span> : "0") },
    { key: "s", header: "Share", value: (r) => r.share, align: "right", render: (r) => pctCell(r.share) },
  ];
  const outletColumnsAll: Column<Row<"byOutlet">>[] = [
    { key: "name", header: "Outlet", value: (r) => r.name, render: (r) => <span className="text-white">{r.name}</span> },
    { key: "inv", header: "Invoices", value: (r) => r.invoices, align: "right", render: (r) => r.invoices },
    { key: "rev", header: "Revenue", value: (r) => r.revenue, align: "right", render: (r) => money(r.revenue) },
    { key: "vat", header: "VAT", value: (r) => r.vat, align: "right", render: (r) => money(r.vat) },
    { key: "gp", header: "Gross profit", value: (r) => r.grossProfit, align: "right", render: (r) => money(r.grossProfit) },
    { key: "margin", header: "Margin", value: (r) => r.margin, align: "right", render: (r) => pctCell(r.margin, 20) },
  ];
  const outletColumns = canFinancial ? outletColumnsAll : outletColumnsAll.filter((column) => column.key !== "gp" && column.key !== "margin");
  const methodColumns: Column<Row<"byMethod">>[] = [
    { key: "m", header: "Method", value: (r) => r.method, render: (r) => <span className="text-white">{r.method}</span> },
    { key: "inv", header: "Invoices", value: (r) => r.invoices, align: "right", render: (r) => r.invoices },
    { key: "amt", header: "Amount", value: (r) => r.amount, align: "right", render: (r) => money(r.amount) },
    { key: "share", header: "Share", value: (r) => r.share, align: "right", render: (r) => pctCell(r.share) },
  ];
  const stockColumns: Column<Row<"stock">>[] = [
    { key: "name", header: "Location", value: (r) => r.name, render: (r) => <span className="text-white">{r.name}</span> },
    { key: "skus", header: "SKUs", value: (r) => r.skus, align: "right", render: (r) => r.skus },
    { key: "units", header: "Units", value: (r) => r.units, align: "right", render: (r) => r.units.toLocaleString() },
    { key: "cost", header: "Cost value", value: (r) => r.costValue, align: "right", render: (r) => money(r.costValue) },
    { key: "retail", header: "Retail value", value: (r) => r.retailValue, align: "right", render: (r) => money(r.retailValue) },
    { key: "exp", header: "Expired", value: (r) => r.expiredValue, align: "right", render: (r) => (r.expiredValue ? <span className="text-rose-300">{money(r.expiredValue)}</span> : "—") },
    { key: "e90", header: "Expiring ≤90d", value: (r) => r.expiring90Value, align: "right", render: (r) => (r.expiring90Value ? <span className="text-amber-300">{money(r.expiring90Value)}</span> : "—") },
    { key: "low", header: "Low stock", value: (r) => r.lowStock, align: "right", render: (r) => r.lowStock },
  ];
  const vatColumns: Column<Row<"vatMonthly">>[] = [
    { key: "month", header: "Month", value: (r) => r.month, render: (r) => <span className="text-white">{r.month}</span> },
    { key: "inv", header: "Invoices", value: (r) => r.invoices, align: "right", render: (r) => r.invoices },
    { key: "tax", header: "Taxable sales", value: (r) => r.taxableSales, align: "right", render: (r) => money(r.taxableSales) },
    { key: "vat", header: "Output VAT 7.5%", value: (r) => r.outputVat, align: "right", render: (r) => <span className="font-medium text-white">{money(r.outputVat)}</span> },
    { key: "due", header: "Return due", value: (r) => r.dueDate, render: (r) => <span className="text-slate-400">{shortDate(r.dueDate)}</span> },
  ];
  const purchaseColumns: Column<Row<"purchases">>[] = [
    { key: "name", header: "Supplier", value: (r) => r.name, render: (r) => <span className="text-white">{r.name}</span> },
    { key: "po", header: "POs", value: (r) => r.orders, align: "right", render: (r) => r.orders },
    { key: "ord", header: "Ordered", value: (r) => r.ordered, align: "right", render: (r) => money(r.ordered) },
    { key: "rec", header: "Received", value: (r) => r.received, align: "right", render: (r) => money(r.received) },
    { key: "fill", header: "Fill rate", value: (r) => r.fillRate, align: "right", render: (r) => (r.orders ? pctCell(r.fillRate, 80) : "—") },
    { key: "pay", header: "Payable", value: (r) => r.outstanding, align: "right", render: (r) => (r.outstanding ? <span className="text-amber-300">{money(r.outstanding)}</span> : "—") },
  ];
  const expenseColumns: Column<Row<"expenses">>[] = [
    { key: "c", header: "Category", value: (r) => r.category, render: (r) => <span className="text-white">{r.category}</span> },
    { key: "n", header: "Vouchers", value: (r) => r.count, align: "right", render: (r) => r.count },
    { key: "a", header: "Amount", value: (r) => r.amount, align: "right", render: (r) => money(r.amount) },
    { key: "s", header: "Share", value: (r) => r.share, align: "right", render: (r) => pctCell(r.share) },
  ];

  const pill = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-emerald-500 font-medium text-emerald-950" : "text-slate-300 hover:bg-slate-800"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title={canFinancial ? "Management reports" : canSales ? "Sales reports" : "Inventory reports"}
        description={`${meta.scopeLabel} · ${shortDate(meta.from)} – ${shortDate(meta.to)}. Generated ${dateTime(meta.generatedAt)} by ${meta.generatedBy}.`}
        actions={
          <div className="flex gap-2 print:hidden">
            <ActionButton tone="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print / PDF
            </ActionButton>
            <a
              href={`/api/reports/export${query({})}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-500 px-3 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel workbook
            </a>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
          {periods.map((days) => (
            <Link key={days} href={query({ days })} className={pill(days === meta.days)} scroll={false}>
              Last {days} days
            </Link>
          ))}
        </div>
        {!meta.locked ? (
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
            <Link href={query({ outlet: null })} className={pill(!meta.outletId)} scroll={false}>All outlets</Link>
            {outlets.map((outlet) => (
              <Link key={outlet.id} href={query({ outlet: outlet.id })} className={pill(meta.outletId === outlet.id)} scroll={false}>
                {outlet.name.replace(/^Outlet \d - /, "")}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {showSales ? (
      <StatGrid
        stats={[
          {
            label: "Revenue (incl. VAT)",
            value: compactMoney(s.revenue),
            note: s.revenueChange === null ? `${s.invoices} invoices` : `${s.revenueChange >= 0 ? "▲" : "▼"} ${Math.abs(s.revenueChange)}% vs previous ${meta.days} days`,
            icon: s.revenueChange !== null && s.revenueChange < 0 ? TrendingDown : TrendingUp,
            tone: s.revenueChange !== null && s.revenueChange < 0 ? "rose" : "emerald",
          },
          ...(canFinancial
            ? [
                { label: "Gross profit", value: compactMoney(s.grossProfit), note: `${s.grossMargin}% margin on ${compactMoney(s.netSales)} net sales`, icon: PiggyBank, tone: "sky" as const },
                { label: "Net operating profit", value: compactMoney(s.netProfit), note: `After ${compactMoney(s.operatingExpenses)} approved expenses`, icon: Banknote, tone: s.netProfit >= 0 ? ("emerald" as const) : ("rose" as const) },
              ]
            : [
                { label: "Invoices", value: s.invoices.toLocaleString(), note: `${s.voided} voided`, icon: Receipt, tone: "sky" as const },
                { label: "Average basket", value: money(s.avgBasket), note: `${compactMoney(s.netSales)} net of VAT`, icon: Banknote, tone: "emerald" as const },
              ]),
          { label: "Output VAT", value: compactMoney(s.vat), note: `${s.invoices} invoices · avg basket ${money(s.avgBasket)}`, icon: Landmark, tone: "amber" },
        ]}
      />
      ) : null}

      {showSales ? (
      <div className={`grid gap-5 ${canFinancial ? "xl:grid-cols-[1.6fr_1fr]" : ""}`}>
        <Panel title="Revenue trend" description={meta.days > 31 ? "Weekly totals" : "Daily totals"}>
          <SalesAreaChart data={report.trend} />
        </Panel>
        {canFinancial ? (
        <Panel title="Profit & loss" description="Simplified operating statement for the period">
          <dl className="space-y-2 text-sm">
            {[
              ["Revenue (incl. VAT)", s.revenue, ""],
              ["Less: output VAT", -s.vat, ""],
              ["Less: discounts", -s.discounts, ""],
              ["Net sales", s.netSales, "font-semibold text-white border-t border-slate-800 pt-2"],
              ["Cost of goods sold", -s.cogs, ""],
              ["Gross profit", s.grossProfit, "font-semibold text-white border-t border-slate-800 pt-2"],
              ["Operating expenses", -s.operatingExpenses, ""],
              ["Net operating profit", s.netProfit, "text-base font-bold text-white border-t-2 border-slate-700 pt-2"],
            ].map(([label, raw, cls]) => ({ label, value: (raw as number) || 0, cls })).map(({ label, value, cls }) => (
              <div key={label as string} className={`flex justify-between ${cls}`}>
                <dt>{label}</dt>
                <dd className={`tabular-nums ${(value as number) < 0 ? "text-rose-300" : ""}`}>{(value as number) < 0 ? `(${money(-(value as number))})` : money(value as number)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-500">COGS uses current item cost prices. {s.voided} voided invoice(s) excluded.</p>
        </Panel>
        ) : null}
      </div>
      ) : null}

      {showSales ? (
      <Panel title="Sales by item" description="Ranked by net revenue (excl. VAT)">
        <DataTable rows={report.byItem} columns={itemColumns} rowKey={(r) => r.name} search={(r) => r.name} exportName="sales-by-item" dense />
      </Panel>
      ) : null}

      {canSales ? (
        <Panel title="Sales performance by cashier" description="Invoices, basket size and voids per cashier — for supervising the sales team">
          <DataTable rows={report.byCashier} columns={cashierColumns} rowKey={(r) => r.cashier} exportName="sales-by-cashier" dense />
        </Panel>
      ) : null}

      {showSales ? (
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Sales by outlet">
          {report.byOutlet.length > 1 ? <OutletBarChart data={report.byOutlet.map((r) => ({ name: r.name.replace(/^Outlet \d - /, ""), value: r.revenue }))} /> : null}
          <DataTable rows={report.byOutlet} columns={outletColumns} rowKey={(r) => r.id} exportName="sales-by-outlet" dense />
        </Panel>
        <Panel title="Payment methods" description="Credit and HMO sales are invoiced; cash is collected later">
          <DataTable rows={report.byMethod} columns={methodColumns} rowKey={(r) => r.method} exportName="payment-methods" dense />
        </Panel>
      </div>

      ) : null}

      {canInventory || canFinancial ? (
      <Panel title="Stock valuation & expiry exposure" description="Position today across locations">
        <DataTable rows={report.stock} columns={stockColumns} rowKey={(r) => r.id} exportName="stock-valuation" dense />
      </Panel>
      ) : null}

      {canFinancial ? (
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="VAT returns" description="Output VAT by month; returns are due by the 21st of the following month">
          <DataTable rows={report.vatMonthly} columns={vatColumns} rowKey={(r) => r.month} exportName="vat" dense />
        </Panel>
        <Panel title="Expenses by category" description="Approved and paid vouchers in the period">
          <DataTable rows={report.expenses} columns={expenseColumns} rowKey={(r) => r.category} emptyMessage="No approved expenses in this period." exportName="expenses" dense />
        </Panel>
      </div>

      ) : null}

      {canInventory || canFinancial ? (
      <Panel title="Purchases by supplier" description="POs raised in the period; payable is the current balance owed">
        <DataTable rows={report.purchases} columns={purchaseColumns} rowKey={(r) => r.id} emptyMessage="No purchasing activity." exportName="purchases" dense />
      </Panel>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Receipt className="h-3.5 w-3.5" /> Figures are computed live from invoices, purchase orders, batches and expense vouchers.
      </p>
    </div>
  );
}
