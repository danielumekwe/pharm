"use client";

import Link from "next/link";
import { AlertOctagon, CalendarClock, PackageCheck, PackagePlus, Trash2, Truck } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { TabBar } from "@/components/erp/tabs";
import { useAction } from "@/components/erp/use-action";
import type { StockMovement } from "@/lib/data";
import { compactMoney, isoDaysFromNow, money, shortDate } from "@/lib/format";

type BatchRow = {
  id: string;
  batchNumber: string;
  productName: string;
  supplier: string;
  location: string;
  outletId: string;
  receivingDate: string;
  manufacturingDate: string;
  expiryDate: string;
  days: number;
  quantityReceived: number;
  availableQuantity: number;
  value: number;
  state: string;
  destructionPending: boolean;
};
type Receipt = StockMovement & { location: string; direct: boolean };
type Delivery = { id: string; number: string; supplierName: string; location: string; expectedDate: string; outstanding: number; value: number; status: string };

export function ReceivingWorkspace({
  batches,
  receipts,
  deliveries,
  items,
  suppliers,
  scope,
  permissions,
}: {
  batches: BatchRow[];
  receipts: Receipt[];
  deliveries: Delivery[];
  items: { id: string; name: string; location: string; cost: number }[];
  suppliers: { id: string; name: string }[];
  scope?: string;
  permissions: { receive: boolean; destroy: boolean };
}) {
  const [receiving, setReceiving] = useState(false);
  const [destroying, setDestroying] = useState<BatchRow | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = isoDaysFromNow(-30).slice(0, 10);
  const expired = batches.filter((row) => row.state === "Expired");
  const near = batches.filter((row) => row.state === "Near expiry");
  const recent = receipts.filter((row) => row.date >= monthStart);

  const batchColumns: Column<BatchRow>[] = [
    { key: "batch", header: "Batch", value: (row) => row.batchNumber, render: (row) => <span className="whitespace-nowrap font-mono text-xs text-white">{row.batchNumber}</span> },
    { key: "item", header: "Item", value: (row) => row.productName, render: (row) => <div><p className="text-white">{row.productName}</p><p className="text-[11px] text-slate-500">{row.supplier}</p></div> },
    { key: "loc", header: "Location", value: (row) => row.location, render: (row) => row.location.replace(/^Outlet \d - /, "") },
    { key: "mfg", header: "Mfg / received", value: (row) => row.receivingDate, render: (row) => <span className="text-xs text-slate-400">{shortDate(row.manufacturingDate)} / {shortDate(row.receivingDate)}</span> },
    { key: "exp", header: "Expiry", value: (row) => row.expiryDate, render: (row) => <span className={`whitespace-nowrap ${row.days < 0 ? "text-rose-300" : row.days <= 120 ? "text-amber-300" : ""}`}>{shortDate(row.expiryDate)} <span className="text-[11px] text-slate-500">({row.days < 0 ? `${-row.days}d ago` : `${row.days}d`})</span></span> },
    { key: "qty", header: "On hand", value: (row) => row.availableQuantity, align: "right", render: (row) => `${row.availableQuantity} / ${row.quantityReceived}` },
    { key: "value", header: "Value (cost)", value: (row) => row.value, align: "right", render: (row) => money(row.value) },
    { key: "state", header: "State", value: (row) => row.state, render: (row) => <StatusBadge status={row.state} tone={row.state === "Depleted" ? "slate" : undefined} /> },
    {
      key: "act",
      header: "",
      render: (row) =>
        row.state === "Expired" && permissions.destroy ? (
          row.destructionPending ? (
            <span className="text-[11px] text-amber-300">Destruction awaiting approval</span>
          ) : (
            <ActionButton tone="danger" className="h-7 text-xs" onClick={() => setDestroying(row)}>
              <Trash2 className="h-3.5 w-3.5" /> Destroy
            </ActionButton>
          )
        ) : null,
    },
  ];

  const receiptColumns: Column<Receipt>[] = [
    { key: "ref", header: "GRN", value: (row) => row.reference, render: (row) => <span className="font-mono text-xs text-white">{row.reference}</span> },
    { key: "date", header: "Date", value: (row) => row.date, render: (row) => <span className="text-slate-400">{shortDate(row.date)}</span> },
    { key: "item", header: "Item", value: (row) => row.productName, render: (row) => row.productName },
    { key: "loc", header: "Location", value: (row) => row.location, render: (row) => row.location.replace(/^Outlet \d - /, "") },
    { key: "qty", header: "Qty", value: (row) => row.quantity, align: "right", render: (row) => <span className="text-emerald-300">+{row.quantity}</span> },
    { key: "source", header: "Source", value: (row) => (row.direct ? "Direct" : "PO"), render: (row) => (row.direct ? <StatusBadge status="No PO" tone="amber" /> : <span className="text-xs text-slate-400">{row.reason ?? "—"}</span>) },
    { key: "by", header: "Received by", value: (row) => row.requestedBy ?? "", render: (row) => <span className="text-slate-400">{row.requestedBy ?? "—"}</span> },
  ];

  const deliveryColumns: Column<Delivery>[] = [
    { key: "po", header: "PO", value: (row) => row.number, render: (row) => <Link href="/purchase" className="font-mono text-xs text-emerald-300 hover:underline">{row.number}</Link> },
    { key: "supplier", header: "Supplier", value: (row) => row.supplierName, render: (row) => <span className="text-white">{row.supplierName}</span> },
    { key: "loc", header: "Deliver to", value: (row) => row.location, render: (row) => row.location },
    { key: "due", header: "Expected", value: (row) => row.expectedDate, render: (row) => <span className={row.expectedDate < today ? "text-rose-300" : "text-slate-400"}>{shortDate(row.expectedDate)}{row.expectedDate < today ? " · overdue" : ""}</span> },
    { key: "units", header: "Outstanding", value: (row) => row.outstanding, align: "right", render: (row) => `${row.outstanding} units` },
    { key: "value", header: "Value", value: (row) => row.value, align: "right", render: (row) => money(row.value) },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goods receipt & batches"
        description="Receive against approved POs from Purchase. Direct receipts (no PO) are for emergencies only and are flagged for audit. Expired batches are sent for destruction with a second approval."
        scope={scope}
        actions={
          permissions.receive ? (
            <>
              <Link href="/purchase" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800">
                <Truck className="h-4 w-4" /> Receive against PO
              </Link>
              <ActionButton onClick={() => setReceiving(true)}>
                <PackagePlus className="h-4 w-4" /> Direct receipt
              </ActionButton>
            </>
          ) : null
        }
      />

      <StatGrid
        stats={[
          { label: "Deliveries due", value: String(deliveries.length), note: `${deliveries.filter((row) => row.expectedDate < today).length} overdue · ${compactMoney(deliveries.reduce((sum, row) => sum + row.value, 0))}`, icon: Truck, tone: "sky" },
          { label: "Received (30d)", value: recent.reduce((sum, row) => sum + row.quantity, 0).toLocaleString(), note: `${recent.length} GRN line(s) · ${recent.filter((row) => row.direct).length} without PO`, icon: PackageCheck, tone: "emerald" },
          { label: "Expired batches", value: String(expired.length), note: `${compactMoney(expired.reduce((sum, row) => sum + row.value, 0))} to destroy`, icon: AlertOctagon, tone: "rose" },
          { label: "Expiring ≤ 120 days", value: String(near.length), note: `${compactMoney(near.reduce((sum, row) => sum + row.value, 0))} at cost`, icon: CalendarClock, tone: "amber" },
        ]}
      />

      <Panel title="Receiving">
        <TabBar
          tabs={[
            {
              key: "batches",
              label: "Batch register",
              count: batches.length,
              content: (
                <DataTable
                  rows={[...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))}
                  columns={batchColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.batchNumber} ${row.productName} ${row.supplier}`}
                  filters={[{ key: "state", label: "States", options: ["Expired", "Near expiry", "Healthy", "Depleted"].map((value) => ({ value, label: value })), get: (row) => row.state }]}
                  exportName="batch-register"
                  dense
                />
              ),
            },
            {
              key: "grn",
              label: "Goods received",
              count: receipts.length,
              content: (
                <DataTable
                  rows={receipts}
                  columns={receiptColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.reference} ${row.productName} ${row.reason ?? ""}`}
                  filters={[{ key: "source", label: "Sources", options: [{ value: "PO", label: "Against PO" }, { value: "Direct", label: "Direct (no PO)" }], get: (row) => (row.direct ? "Direct" : "PO") }]}
                  exportName="goods-received"
                  dense
                />
              ),
            },
            {
              key: "due",
              label: "Awaiting delivery",
              count: deliveries.length,
              content: <DataTable rows={deliveries} columns={deliveryColumns} rowKey={(row) => row.id} emptyMessage="No approved POs awaiting delivery." dense />,
            },
          ]}
        />
      </Panel>

      {receiving ? <DirectReceiptModal items={items} suppliers={suppliers} onClose={() => setReceiving(false)} /> : null}
      {destroying ? <DestroyModal batch={destroying} onClose={() => setDestroying(null)} /> : null}
    </div>
  );
}

function DirectReceiptModal({
  items,
  suppliers,
  onClose,
}: {
  items: { id: string; name: string; location: string; cost: number }[];
  suppliers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState(() => ({
    productId: items[0]?.id ?? "",
    supplierId: suppliers[0]?.id ?? "",
    quantity: "",
    unitCost: String(items[0]?.cost ?? ""),
    batchNumber: "",
    manufacturingDate: isoDaysFromNow(-60).slice(0, 10),
    expiryDate: isoDaysFromNow(540).slice(0, 10),
    reason: "",
  }));
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Modal open title="Direct goods receipt" description="For deliveries without a purchase order. Flagged on the audit trail; same batch and expiry rules as PO receipts." onClose={onClose} wide>
      <div className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Item & location">
            <SelectInput
              value={form.productId}
              onChange={(event) => {
                const item = items.find((row) => row.id === event.target.value);
                setForm((current) => ({ ...current, productId: event.target.value, unitCost: String(item?.cost ?? current.unitCost) }));
              }}
              options={items.map((row) => ({ value: row.id, label: `${row.name} — ${row.location}` }))}
            />
          </Field>
          <Field label="Supplier"><SelectInput value={form.supplierId} onChange={set("supplierId")} options={suppliers.map((row) => ({ value: row.id, label: row.name }))} /></Field>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Batch no."><TextInput value={form.batchNumber} onChange={set("batchNumber")} placeholder="e.g. AMX-3520" /></Field>
          <Field label="Quantity"><TextInput type="number" min={1} value={form.quantity} onChange={set("quantity")} /></Field>
          <Field label="Unit cost (₦)"><TextInput type="number" min={1} value={form.unitCost} onChange={set("unitCost")} /></Field>
          <Field label="Mfg date"><TextInput type="date" value={form.manufacturingDate} onChange={set("manufacturingDate")} /></Field>
          <Field label="Expiry date"><TextInput type="date" value={form.expiryDate} onChange={set("expiryDate")} /></Field>
        </div>
        <Field label="Why is there no PO?"><TextInput value={form.reason} onChange={set("reason")} placeholder="e.g. Emergency insulin top-up approved by phone by the pharmacy manager" /></Field>
        <p className="text-xs text-slate-500">Stock with under 6 months to expiry is rejected. Duplicate batch numbers for the same item are blocked.</p>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy || !form.batchNumber || !(Number(form.quantity) > 0) || form.reason.trim().length < 3}
            onClick={async () => {
              const ok = await run("/api/batches", "POST", { ...form, quantity: Math.floor(Number(form.quantity)), unitCost: Number(form.unitCost) });
              if (ok) onClose();
            }}
          >
            Post GRN
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function DestroyModal({ batch, onClose }: { batch: BatchRow; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [note, setNote] = useState("");
  return (
    <Modal open title={`Destroy batch ${batch.batchNumber}`} description={`${batch.availableQuantity} × ${batch.productName} at ${batch.location} · expired ${shortDate(batch.expiryDate)}`} onClose={onClose}>
      <div className="grid gap-3">
        <p className="text-sm text-slate-300">
          This raises a write-off of <span className="font-semibold text-white">{money(batch.value)}</span> (at cost). It takes effect once a different user approves it on the Stock page, and it is recorded on the compliance register.
        </p>
        <Field label="Note (optional)"><TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Witnessed by NAFDAC officer, certificate no." /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone="danger" disabled={busy} onClick={async () => (await run(`/api/batches/${batch.id}`, "PATCH", { action: "destroy", note })) && onClose()}>
            Request destruction
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
