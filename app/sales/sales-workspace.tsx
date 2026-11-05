"use client";

import Link from "next/link";
import { Banknote, Eye, Printer, Receipt, RotateCcw, ShoppingCart, Undo2, XCircle } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import type { HistoryRow } from "@/lib/erp/pos";
import type { SaleInvoice } from "@/lib/erp/types";
import { dateTime, money } from "@/lib/format";

type Filters = { from: string; to: string; outletId: string; cashierId: string; method: string; status: string };
type Totals = { transactions: number; gross: number; discount: number; returns: number; net: number; voided: number };

const METHOD_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "Card", label: "POS terminal" },
  { value: "Transfer", label: "Bank transfer" },
  { value: "Credit", label: "Credit" },
  { value: "HMO", label: "HMO" },
  { value: "Account", label: "On account" },
];

export function SalesWorkspace({
  rows,
  sales,
  totals,
  filters,
  returned,
  outlets,
  cashiers,
  initialQuery,
  scope,
  ownOnly,
  canCreate,
  canVoid,
}: {
  rows: HistoryRow[];
  sales: Record<string, SaleInvoice>;
  totals: Totals;
  filters: Filters;
  returned: Record<string, Record<string, number>>;
  outlets: { id: string; name: string }[];
  cashiers: { id: string; name: string }[];
  initialQuery: string;
  scope?: string;
  ownOnly: boolean;
  canCreate: boolean;
  canVoid: boolean;
}) {
  const [viewing, setViewing] = useState<SaleInvoice | null>(null);
  const [voiding, setVoiding] = useState<SaleInvoice | null>(null);
  const [returning, setReturning] = useState<SaleInvoice | null>(null);
  const outletLabel = (id: string) => outlets.find((outlet) => outlet.id === id)?.name ?? id;

  const columns: Column<HistoryRow>[] = [
    { key: "number", header: "Reference", value: (row) => row.number, render: (row) => <span className="font-mono text-xs text-white">{row.number}</span> },
    { key: "date", header: "Date & time", value: (row) => row.date, render: (row) => <span className="whitespace-nowrap text-slate-400">{dateTime(row.date)}</span> },
    { key: "customer", header: "Customer", value: (row) => row.customer, render: (row) => <div><p className="text-white">{row.customer}</p>{row.prescriptionRef ? <p className="text-[11px] text-sky-300">Rx {row.prescriptionRef}</p> : null}</div> },
    { key: "cashier", header: "Cashier", value: (row) => row.cashier, render: (row) => row.cashier },
    ...(outlets.length > 1 ? [{ key: "outlet", header: "Outlet", value: (row: HistoryRow) => row.outlet, render: (row: HistoryRow) => row.outlet.replace(/^Outlet \d - /, "") }] : []),
    { key: "items", header: "Items", value: (row) => row.items, align: "right", render: (row) => row.items },
    { key: "gross", header: "Gross", value: (row) => row.gross, align: "right", render: (row) => money(row.gross) },
    { key: "discount", header: "Discount", value: (row) => row.discount, align: "right", render: (row) => (row.discount ? <span className="text-amber-300">−{money(row.discount)}</span> : <span className="text-slate-500">—</span>) },
    { key: "returns", header: "Returns", value: (row) => row.returns, align: "right", render: (row) => (row.returns ? <span className="text-rose-300">−{money(row.returns)}</span> : <span className="text-slate-500">—</span>) },
    { key: "net", header: "Net", value: (row) => row.net, align: "right", render: (row) => <span className="font-semibold text-white">{row.status === "Voided" ? <span className="text-slate-500 line-through">{money(row.gross - row.discount)}</span> : money(row.net)}</span> },
    { key: "payment", header: "Payment", value: (row) => row.status, render: (row) => <div><StatusBadge status={row.status} /><p className="mt-0.5 text-[11px] text-slate-500">{row.paymentLabel}</p></div> },
    {
      key: "actions",
      header: "",
      render: (row) => {
        const sale = sales[row.id];
        return (
          <div className="flex justify-end gap-1">
            {sale ? <button type="button" onClick={() => setViewing(sale)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`View ${row.number}`} title="View details"><Eye className="h-4 w-4" /></button> : null}
            <a href={`/api/sales/${row.id}/receipt?format=pdf&print=1`} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`Print receipt ${row.number}`} title="Print / reprint receipt"><Printer className="h-4 w-4" /></a>
            {canVoid && sale && row.status !== "Voided" ? (
              <button type="button" onClick={() => setReturning(sale)} className="rounded-lg p-1.5 text-slate-400 hover:bg-amber-500/10 hover:text-amber-300" aria-label={`Return items on ${row.number}`} title="Return / refund"><RotateCcw className="h-4 w-4" /></button>
            ) : null}
            {canVoid && sale && row.status !== "Voided" ? (
              <button type="button" onClick={() => setVoiding(sale)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300" aria-label={`Void ${row.number}`} title="Void"><XCircle className="h-4 w-4" /></button>
            ) : null}
          </div>
        );
      },
    },
  ];

  const select = "h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-white";
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Main"
        title={ownOnly ? "My sales history" : "Sales history"}
        description="Completed, held-over and voided transactions with discounts, returns and net amounts. Voided sales never count towards sales totals."
        scope={scope}
        actions={
          canCreate ? (
            <Link href="/pos" className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-[#fff] hover:bg-blue-700">
              <ShoppingCart className="h-4 w-4" /> New sale
            </Link>
          ) : null
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <label className="grid gap-1 text-xs text-slate-400">From<input type="date" name="from" defaultValue={filters.from} className={select} /></label>
        <label className="grid gap-1 text-xs text-slate-400">To<input type="date" name="to" defaultValue={filters.to} className={select} /></label>
        {outlets.length > 1 ? (
          <label className="grid gap-1 text-xs text-slate-400">Outlet<select name="outletId" defaultValue={filters.outletId} className={select}><option value="">All outlets</option>{outlets.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        ) : null}
        {!ownOnly ? (
          <label className="grid gap-1 text-xs text-slate-400">Cashier<select name="cashierId" defaultValue={filters.cashierId} className={select}><option value="">All cashiers</option>{cashiers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        ) : null}
        <label className="grid gap-1 text-xs text-slate-400">Payment method<select name="method" defaultValue={filters.method} className={select}><option value="">Any</option>{METHOD_OPTIONS.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-slate-400">Status<select name="status" defaultValue={filters.status} className={select}><option value="">Any</option>{["Paid", "Partially paid", "Unpaid", "Voided"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="submit" className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-[#fff] hover:bg-blue-700">Apply filters</button>
        <Link href="/sales" className="h-9 rounded-lg border border-slate-700 px-3 text-sm leading-9 text-slate-300 hover:bg-slate-800">Reset</Link>
      </form>

      <StatGrid
        stats={[
          { label: "Completed transactions", value: totals.transactions.toLocaleString(), note: `${totals.voided} voided (excluded)`, icon: Receipt, tone: "emerald" },
          { label: "Gross sales", value: money(totals.gross), note: "Before discounts and returns, excl. VAT", icon: ShoppingCart, tone: "sky" },
          { label: "Discounts & returns", value: money(totals.discount + totals.returns), note: `Discounts ${money(totals.discount)} · returns ${money(totals.returns)}`, icon: Undo2, tone: "amber" },
          { label: "Net sales", value: money(totals.net), note: "Gross − discounts − returns", icon: Banknote, tone: "rose" },
        ]}
      />

      <Panel title="Transactions" description={rows.length >= 1000 ? "Showing the latest 1,000 transactions for these filters." : `${rows.length.toLocaleString()} transaction(s)`}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          initialQuery={initialQuery}
          search={(row) => `${row.number} ${row.customer} ${row.cashier} ${row.prescriptionRef}`}
          exportName="sales-history"
          pageSize={15}
        />
      </Panel>

      <InvoiceModal sale={viewing} outletLabel={outletLabel} onClose={() => setViewing(null)} />
      {voiding ? <VoidModal sale={voiding} onClose={() => setVoiding(null)} /> : null}
      {returning ? <ReturnModal sale={returning} returned={returned[returning.id] ?? {}} onClose={() => setReturning(null)} /> : null}
    </div>
  );
}

function InvoiceModal({ sale, outletLabel, onClose }: { sale: SaleInvoice | null; outletLabel: (id: string) => string; onClose: () => void }) {
  if (!sale) return null;
  return (
    <Modal open title={`Invoice ${sale.number}`} description={`${outletLabel(sale.outletId)} · ${dateTime(sale.date)} · Cashier ${sale.cashier}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={sale.status} />
          <span className="text-slate-300">{sale.customerName}</span>
          <span className="text-slate-500">{sale.paymentMethod}</span>
          {sale.prescriptionRef ? <span className="text-sky-300">Rx {sale.prescriptionRef}</span> : null}
        </div>
        {sale.voidReason ? <p className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-300">Void reason: {sale.voidReason}</p> : null}
        <table className="w-full">
          <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
            <tr><th className="py-2">Item</th><th className="py-2">Batch</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Price</th><th className="py-2 text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sale.lines.map((line, index) => (
              <tr key={`${line.productId}-${index}`}>
                <td className="py-2 text-white">{line.productName}</td>
                <td className="py-2 font-mono text-xs text-slate-400">{line.batchNumbers.join(", ") || "historic"}</td>
                <td className="py-2 text-right tabular-nums">
                  {line.packQuantity && line.unitsPerPackage && line.unitsPerPackage > 1 ? (
                    <>
                      {line.packQuantity} {line.packagingName}
                      <span className="block text-[11px] text-slate-500">{line.quantity} units</span>
                    </>
                  ) : (
                    line.quantity
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{money(line.packPrice ?? line.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums text-white">{money(line.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto max-w-xs space-y-1">
          <div className="flex justify-between text-slate-400"><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
          {sale.discount ? <div className="flex justify-between text-slate-400"><span>Discount</span><span>-{money(sale.discount)}</span></div> : null}
          <div className="flex justify-between text-slate-400"><span>VAT</span><span>{money(sale.vat)}</span></div>
          <div className="flex justify-between font-semibold text-white"><span>Total</span><span>{money(sale.total)}</span></div>
          <div className="flex justify-between text-slate-400"><span>Paid</span><span>{money(sale.amountPaid)}</span></div>
        </div>
      </div>
    </Modal>
  );
}

function VoidModal({ sale, onClose }: { sale: SaleInvoice; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal open title={`Void ${sale.number}`} description="Stock is returned to its batch and any payment is refunded from the till." onClose={onClose}>
      <div className="space-y-4">
        <Field label="Reason">
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Wrong strength dispensed" />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            tone="danger"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              if (await run(`/api/sales/${sale.id}`, "PATCH", { action: "void", reason })) onClose();
            }}
          >
            Void sale
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function ReturnModal({ sale, returned, onClose }: { sale: SaleInvoice; returned: Record<string, number>; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"Cash" | "Card" | "Transfer" | "Account credit">(sale.paymentMethod === "Card" ? "Card" : sale.paymentMethod === "Transfer" ? "Transfer" : "Cash");
  const [restock, setRestock] = useState(false);
  const net = sale.subtotal - sale.discount;
  const vatRatio = net > 0 ? sale.vat / net : 0;
  // Returns are per item in base units, even when it was sold in several package sizes.
  const grouped = Object.values(
    sale.lines.reduce<Record<string, { productId: string; productName: string; quantity: number; total: number }>>((acc, line) => {
      const row = (acc[line.productId] ??= { productId: line.productId, productName: line.productName, quantity: 0, total: 0 });
      row.quantity += line.quantity;
      row.total += line.total;
      return acc;
    }, {}),
  );
  const total = grouped.reduce((sum, line) => sum + ((quantities[line.productId] ?? 0) * line.total) / line.quantity, 0) * (1 + vatRatio);
  const outstanding = Math.max(0, sale.total - sale.amountPaid);

  return (
    <Modal open title={`Return items · ${sale.number}`} description={`${sale.customerName} · ${sale.paymentMethod}. Refunds are calculated per unit after discounts, plus the VAT charged.`} onClose={onClose} wide>
      <div className="grid gap-4 text-sm">
        <table className="w-full">
          <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
            <tr><th className="py-2">Item</th><th className="py-2 text-right">Sold</th><th className="py-2 text-right">Already returned</th><th className="py-2 text-right">Return now</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {grouped.map((line) => {
              const available = line.quantity - (returned[line.productId] ?? 0);
              return (
                <tr key={line.productId}>
                  <td className="py-2 text-white">{line.productName}</td>
                  <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{returned[line.productId] ?? 0}</td>
                  <td className="py-2 text-right">
                    <TextInput type="number" min={0} max={available} disabled={available === 0} value={quantities[line.productId] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [line.productId]: Math.max(0, Math.min(available, Math.floor(Number(event.target.value) || 0))) }))} className="ml-auto w-20 text-right" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Reason"><TextInput value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Wrong strength dispensed; unopened" /></Field>
          <Field label="Refund method" hint={outstanding > 0 ? `Up to ${money(outstanding)} is first deducted from the unpaid balance.` : undefined}>
            <SelectInput value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as typeof refundMethod)} options={["Cash", "Card", "Transfer", "Account credit"].map((value) => ({ value, label: value === "Card" ? "POS terminal (card)" : value }))} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-green-700" checked={restock} onChange={(event) => setRestock(event.target.checked)} />
          <span>Return to saleable stock (unopened, in-date OTC items only). Leave unticked for items that must be disposed of. Prescription-only and controlled medicines cannot be restocked.</span>
        </label>
        <FormError message={error} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-slate-300">Refund total <span className="font-semibold text-white">{money(total)}</span></p>
          <div className="flex gap-2">
            <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
            <ActionButton
              disabled={busy || total <= 0 || reason.trim().length < 3}
              onClick={async () => {
                const lines = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));
                if (await run(`/api/sales/${sale.id}/returns`, "POST", { lines, reason, refundMethod, restock })) onClose();
              }}
            >
              <RotateCcw className="h-4 w-4" /> Record return
            </ActionButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
