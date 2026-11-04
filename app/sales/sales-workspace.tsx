"use client";

import { Banknote, Eye, PlusCircle, Receipt, RotateCcw, ShoppingCart, Trash2, Users, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import type { PaymentMethod, SaleInvoice } from "@/lib/erp/types";
import { compactMoney, dateTime, money } from "@/lib/format";

type CatalogItem = { id: string; name: string; strength: string; sellingPrice: number; rxOnly: boolean; controlled: boolean; available: number };
type CustomerOption = { id: string; name: string; type: string; status: string; available: number };

const METHODS: PaymentMethod[] = ["Cash", "Card", "Transfer", "Credit", "HMO"];

export function SalesWorkspace({
  returned,
  vatRate,
  totalCount,
  sales,
  kpis,
  outlets,
  catalog,
  customers,
  scope,
  canCreate,
  canVoid,
}: {
  returned: Record<string, Record<string, number>>;
  vatRate: number;
  totalCount: number;
  sales: SaleInvoice[];
  kpis: { todaySales: number; gross: number; count: number; avgBasket: number; receivable: number; voided: number };
  outlets: { id: string; name: string }[];
  catalog: Record<string, CatalogItem[]>;
  customers: CustomerOption[];
  scope?: string;
  canCreate: boolean;
  canVoid: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<SaleInvoice | null>(null);
  const [voiding, setVoiding] = useState<SaleInvoice | null>(null);
  const [returning, setReturning] = useState<SaleInvoice | null>(null);
  const outletLabel = (id: string) => outlets.find((outlet) => outlet.id === id)?.name ?? id;

  const columns: Column<SaleInvoice>[] = [
    { key: "number", header: "Invoice", value: (row) => row.number, render: (row) => <span className="font-mono text-xs text-white">{row.number}</span> },
    { key: "date", header: "Date", value: (row) => row.date, render: (row) => <span className="text-slate-400">{dateTime(row.date)}</span> },
    { key: "outlet", header: "Outlet", value: (row) => outletLabel(row.outletId), render: (row) => outletLabel(row.outletId).replace(/^Outlet \d - /, "") },
    {
      key: "customer",
      header: "Customer",
      value: (row) => row.customerName,
      render: (row) => (
        <div>
          <p className="text-white">{row.customerName}</p>
          {row.prescriptionRef ? <p className="text-[11px] text-sky-300">Rx {row.prescriptionRef}</p> : null}
        </div>
      ),
    },
    { key: "items", header: "Items", value: (row) => row.lines.reduce((sum, line) => sum + line.quantity, 0), align: "right", render: (row) => row.lines.reduce((sum, line) => sum + line.quantity, 0) },
    { key: "total", header: "Total", value: (row) => row.total, align: "right", render: (row) => <span className="font-medium text-white">{money(row.total)}</span> },
    { key: "due", header: "Balance", value: (row) => (row.status === "Voided" ? 0 : row.total - row.amountPaid), align: "right", render: (row) => (row.status === "Voided" || row.total === row.amountPaid ? <span className="text-slate-500">—</span> : <span className="text-amber-300">{money(row.total - row.amountPaid)}</span>) },
    { key: "method", header: "Method", value: (row) => row.paymentMethod, render: (row) => row.paymentMethod },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button type="button" onClick={() => setViewing(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`View ${row.number}`}>
            <Eye className="h-4 w-4" />
          </button>
          {canVoid && row.status !== "Voided" ? (
            <button type="button" onClick={() => setReturning(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-amber-500/10 hover:text-amber-300" aria-label={`Return items on ${row.number}`} title="Return / refund">
              <RotateCcw className="h-4 w-4" />
            </button>
          ) : null}
          {canVoid && row.status !== "Voided" ? (
            <button type="button" onClick={() => setVoiding(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300" aria-label={`Void ${row.number}`}>
              <XCircle className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales & POS"
        description="Retail, prescription and institutional (HMO / corporate) sales with FEFO batch picking, VAT and credit control."
        scope={scope}
        actions={
          canCreate ? (
            <ActionButton onClick={() => setCreating(true)}>
              <PlusCircle className="h-4 w-4" /> New sale
            </ActionButton>
          ) : null
        }
      />

      <StatGrid
        stats={[
          { label: "Today's sales", value: money(kpis.todaySales), note: `Incl. ${vatRate}% VAT, excl. voids`, icon: ShoppingCart, tone: "emerald" },
          { label: "30-day revenue", value: compactMoney(kpis.gross), note: `${kpis.count.toLocaleString()} invoices`, icon: Receipt, tone: "sky" },
          { label: "Average basket", value: money(kpis.avgBasket), note: "Last 30 days", icon: Banknote, tone: "amber" },
          { label: "Receivables", value: compactMoney(kpis.receivable), note: `${kpis.voided} voided invoice(s)`, icon: Users, tone: "rose" },
        ]}
      />

      <Panel title="Sales register" description={`Every invoice is linked to the batches it was picked from.${totalCount > sales.length ? ` Showing the latest ${sales.length} of ${totalCount.toLocaleString()}; use Reports for full history.` : ""}`}>
        <DataTable
          rows={sales}
          columns={columns}
          rowKey={(row) => row.id}
          search={(row) => `${row.number} ${row.customerName} ${row.cashier} ${row.prescriptionRef ?? ""} ${row.lines.map((line) => line.productName).join(" ")}`}
          filters={[
            ...(outlets.length > 1 ? [{ key: "outlet", label: "Outlets", options: outlets.map((outlet) => ({ value: outlet.id, label: outlet.name })), get: (row: SaleInvoice) => row.outletId }] : []),
            { key: "status", label: "Statuses", options: ["Paid", "Partially paid", "Unpaid", "Voided"].map((value) => ({ value, label: value })), get: (row) => row.status },
            { key: "method", label: "Methods", options: METHODS.map((value) => ({ value, label: value })), get: (row) => row.paymentMethod },
          ]}
          exportName="sales-register"
        />
      </Panel>

      {creating ? <NewSaleModal vatRate={vatRate} outlets={outlets} catalog={catalog} customers={customers} onClose={() => setCreating(false)} /> : null}
      <InvoiceModal sale={viewing} outletLabel={outletLabel} onClose={() => setViewing(null)} />
      {voiding ? <VoidModal sale={voiding} onClose={() => setVoiding(null)} /> : null}
      {returning ? <ReturnModal sale={returning} returned={returned[returning.id] ?? {}} onClose={() => setReturning(null)} /> : null}
    </div>
  );
}

function NewSaleModal({
  vatRate,
  outlets,
  catalog,
  customers,
  onClose,
}: {
  vatRate: number;
  outlets: { id: string; name: string }[];
  catalog: Record<string, CatalogItem[]>;
  customers: CustomerOption[];
  onClose: () => void;
}) {
  const { run, error, setError, busy } = useAction();
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [amountPaid, setAmountPaid] = useState("0");
  const [prescriptionRef, setPrescriptionRef] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: number }[]>([]);
  const [picker, setPicker] = useState("");

  const items = catalog[outletId] ?? [];
  const customer = customers.find((row) => row.id === customerId);
  const detailed = lines.map((line) => ({ ...line, item: items.find((item) => item.id === line.productId)! })).filter((line) => line.item);
  const subtotal = detailed.reduce((sum, line) => sum + line.item.sellingPrice * line.quantity, 0);
  const vat = Math.round(subtotal * (vatRate / 100));
  const total = subtotal + vat;
  const needsRx = detailed.some((line) => line.item.rxOnly);
  const isCredit = method === "Credit" || method === "HMO";

  const outletCustomers = useMemo(() => customers, [customers]);

  function addLine(productId: string) {
    if (!productId) return;
    setLines((current) =>
      current.some((line) => line.productId === productId)
        ? current.map((line) => (line.productId === productId ? { ...line, quantity: line.quantity + 1 } : line))
        : [...current, { productId, quantity: 1 }],
    );
    setPicker("");
  }

  async function submit() {
    const result = await run("/api/sales", "POST", {
      outletId,
      customerId,
      paymentMethod: method,
      amountPaid: isCredit ? Number(amountPaid) || 0 : undefined,
      prescriptionRef: prescriptionRef || undefined,
      lines,
    });
    if (result) onClose();
  }

  return (
    <Modal open title="New sale" description="Stock is picked first-expiry-first-out; expired batches are blocked automatically." onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Outlet">
            <SelectInput
              value={outletId}
              disabled={outlets.length < 2}
              onChange={(event) => {
                setOutletId(event.target.value);
                setLines([]);
              }}
              options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
            />
          </Field>
          <Field label="Customer" hint={customer && customer.type !== "Walk-in" ? `Available credit ${money(customer.available)}` : undefined}>
            <SelectInput
              value={customerId}
              onChange={(event) => {
                setCustomerId(event.target.value);
                const next = customers.find((row) => row.id === event.target.value);
                setMethod(next?.type === "HMO" ? "HMO" : next?.type === "Walk-in" ? "Cash" : method);
              }}
              options={outletCustomers.map((row) => ({ value: row.id, label: `${row.name}${row.status === "On hold" ? " (on hold)" : ""}` }))}
            />
          </Field>
          <Field label="Payment method">
            <SelectInput value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)} options={METHODS.map((value) => ({ value, label: value }))} />
          </Field>
        </div>

        <Field label="Add item">
          <SelectInput
            value={picker}
            onChange={(event) => addLine(event.target.value)}
            options={[
              { value: "", label: items.length ? "Select an item to add…" : "No items stocked at this outlet" },
              ...items.map((item) => ({
                value: item.id,
                label: `${item.name} · ${money(item.sellingPrice)} · ${item.available} sellable${item.rxOnly ? " · Rx" : ""}${item.controlled ? " · CD" : ""}`,
              })),
            ]}
          />
        </Field>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-950/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Line total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {detailed.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    No items yet.
                  </td>
                </tr>
              ) : (
                detailed.map((line) => (
                  <tr key={line.productId}>
                    <td className="px-3 py-2">
                      <p className="text-white">{line.item.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {line.item.available} sellable
                        {line.item.rxOnly ? <span className="ml-2 text-sky-300">Prescription only</span> : null}
                        {line.item.controlled ? <span className="ml-2 text-rose-300">Controlled drug</span> : null}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(line.item.sellingPrice)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={1}
                        max={line.item.available}
                        value={line.quantity}
                        onChange={(event) =>
                          setLines((current) => current.map((row) => (row.productId === line.productId ? { ...row, quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)) } : row)))
                        }
                        className={`h-8 w-20 rounded-lg border bg-slate-950 px-2 text-right text-white ${line.quantity > line.item.available ? "border-rose-500" : "border-slate-700"}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-white">{money(line.item.sellingPrice * line.quantity)}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => setLines((current) => current.filter((row) => row.productId !== line.productId))} className="rounded p-1 text-slate-500 hover:text-rose-300" aria-label="Remove line">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            {needsRx ? (
              <Field label="Prescription reference" hint="Required: basket contains prescription-only medicines.">
                <TextInput value={prescriptionRef} onChange={(event) => setPrescriptionRef(event.target.value)} placeholder="e.g. RX-448120 / prescriber name" />
              </Field>
            ) : null}
            {isCredit ? (
              <Field label="Amount paid now" hint="The balance is posted to the customer's account.">
                <TextInput type="number" min={0} value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} />
              </Field>
            ) : null}
          </div>
          <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
            <div className="flex justify-between text-slate-400"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
            <div className="flex justify-between text-slate-400"><span>VAT {vatRate}%</span><span className="tabular-nums">{money(vat)}</span></div>
            <div className="flex justify-between border-t border-slate-800 pt-2 text-base font-semibold text-white"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
          </div>
        </div>

        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy || detailed.length === 0}
            onClick={() => {
              setError(null);
              void submit();
            }}
          >
            {busy ? "Posting…" : `Complete sale · ${money(total)}`}
          </ActionButton>
        </div>
      </div>
    </Modal>
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
            {sale.lines.map((line) => (
              <tr key={line.productId}>
                <td className="py-2 text-white">{line.productName}</td>
                <td className="py-2 font-mono text-xs text-slate-400">{line.batchNumbers.join(", ") || "historic"}</td>
                <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                <td className="py-2 text-right tabular-nums">{money(line.unitPrice)}</td>
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
  const total = sale.lines.reduce((sum, line) => sum + ((quantities[line.productId] ?? 0) * line.total) / line.quantity, 0) * (1 + vatRatio);
  const outstanding = Math.max(0, sale.total - sale.amountPaid);

  return (
    <Modal open title={`Return items · ${sale.number}`} description={`${sale.customerName} · ${sale.paymentMethod}. Refunds are calculated per unit after discounts, plus the VAT charged.`} onClose={onClose} wide>
      <div className="grid gap-4 text-sm">
        <table className="w-full">
          <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
            <tr><th className="py-2">Item</th><th className="py-2 text-right">Sold</th><th className="py-2 text-right">Already returned</th><th className="py-2 text-right">Return now</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sale.lines.map((line) => {
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
