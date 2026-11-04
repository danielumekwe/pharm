"use client";

import { CheckCircle2, ClipboardCheck, Eye, PackageCheck, PlusCircle, ReceiptText, Send, Trash2, Truck, XCircle } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/erp/types";
import { compactMoney, isoDaysFromNow, money, shortDate } from "@/lib/format";

type SupplierOption = { id: string; name: string; status: string; balance: number };
type CatalogItem = { id: string; name: string; unitCost: number };
type Permissions = { create: boolean; approve: boolean; receive: boolean; superAdmin: boolean };

const STATUSES: PurchaseOrderStatus[] = ["Draft", "Pending approval", "Approved", "Partially received", "Received", "Cancelled"];

function receivedPct(order: PurchaseOrder) {
  const ordered = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const received = order.lines.reduce((sum, line) => sum + line.receivedQuantity, 0);
  return ordered ? Math.round((received / ordered) * 100) : 0;
}

export function PurchaseWorkspace({
  orders,
  suppliers,
  catalog,
  locations,
  actorId,
  scope,
  permissions,
}: {
  orders: PurchaseOrder[];
  suppliers: SupplierOption[];
  catalog: CatalogItem[];
  locations: { id: string; name: string }[];
  actorId: string;
  scope?: string;
  permissions: Permissions;
}) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const locationName = (id: string) => locations.find((row) => row.id === id)?.name ?? id;
  const today = new Date().toISOString().slice(0, 10);

  const open = orders.filter((order) => ["Pending approval", "Approved", "Partially received"].includes(order.status));
  const pending = orders.filter((order) => order.status === "Pending approval");
  const awaiting = orders.filter((order) => order.status === "Approved" || order.status === "Partially received");
  const payable = suppliers.reduce((sum, supplier) => sum + supplier.balance, 0);

  const columns: Column<PurchaseOrder>[] = [
    { key: "number", header: "PO number", value: (row) => row.number, render: (row) => <span className="font-mono text-xs text-white">{row.number}</span> },
    { key: "supplier", header: "Supplier", value: (row) => row.supplierName, render: (row) => <span className="text-white">{row.supplierName}</span> },
    { key: "location", header: "Deliver to", value: (row) => locationName(row.outletId), render: (row) => locationName(row.outletId) },
    { key: "created", header: "Raised", value: (row) => row.createdAt, render: (row) => <span className="text-slate-400">{shortDate(row.createdAt)} · {row.createdBy}</span> },
    {
      key: "expected",
      header: "Expected",
      value: (row) => row.expectedDate,
      render: (row) => {
        const overdue = row.expectedDate < today && (row.status === "Approved" || row.status === "Partially received");
        return <span className={overdue ? "text-rose-300" : "text-slate-400"}>{shortDate(row.expectedDate)}{overdue ? " · overdue" : ""}</span>;
      },
    },
    { key: "total", header: "Value", value: (row) => row.total, align: "right", render: (row) => <span className="font-medium text-white">{money(row.total)}</span> },
    {
      key: "received",
      header: "Received",
      value: receivedPct,
      render: (row) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-emerald-400" style={{ width: `${receivedPct(row)}%` }} />
          </div>
          <span className="text-xs text-slate-400">{receivedPct(row)}%</span>
        </div>
      ),
    },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "open",
      header: "",
      render: (row) => (
        <button type="button" onClick={() => setSelectedId(row.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`Open ${row.number}`}>
          <Eye className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase orders"
        description="Raise → approve → receive. Receipts capture batch and expiry, post stock to the delivery location and update supplier payables."
        scope={scope}
        actions={
          permissions.create ? (
            <ActionButton onClick={() => setCreating(true)}>
              <PlusCircle className="h-4 w-4" /> New purchase order
            </ActionButton>
          ) : null
        }
      />

      <StatGrid
        stats={[
          { label: "Open POs", value: String(open.length), note: `${compactMoney(open.reduce((sum, order) => sum + order.total, 0))} committed`, icon: ReceiptText, tone: "sky" },
          { label: "Awaiting approval", value: String(pending.length), note: permissions.approve ? "Requires your sign-off" : "With pharmacy manager", icon: ClipboardCheck, tone: "amber" },
          { label: "Awaiting delivery", value: String(awaiting.length), note: `${awaiting.filter((order) => order.expectedDate < today).length} overdue`, icon: Truck, tone: "rose" },
          { label: "Supplier payables", value: compactMoney(payable), note: "Received, not yet paid", icon: PackageCheck, tone: "emerald" },
        ]}
      />

      <Panel title="Purchase order register">
        <DataTable
          rows={orders}
          columns={columns}
          rowKey={(row) => row.id}
          search={(row) => `${row.number} ${row.supplierName} ${row.createdBy} ${row.lines.map((line) => line.productName).join(" ")}`}
          filters={[
            { key: "status", label: "Statuses", options: STATUSES.map((value) => ({ value, label: value })), get: (row) => row.status },
            { key: "supplier", label: "Suppliers", options: suppliers.map((row) => ({ value: row.id, label: row.name })), get: (row) => row.supplierId },
            ...(locations.length > 1 ? [{ key: "location", label: "Locations", options: locations.map((row) => ({ value: row.id, label: row.name })), get: (row: PurchaseOrder) => row.outletId }] : []),
          ]}
          exportName="purchase-orders"
        />
      </Panel>

      {creating ? <NewPurchaseOrderModal suppliers={suppliers} catalog={catalog} locations={locations} onClose={() => setCreating(false)} /> : null}
      {selected ? (
        <PurchaseOrderModal
          key={`${selected.id}-${selected.status}`}
          order={selected}
          locationName={locationName}
          actorId={actorId}
          permissions={permissions}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

function NewPurchaseOrderModal({
  suppliers,
  catalog,
  locations,
  onClose,
}: {
  suppliers: SupplierOption[];
  catalog: CatalogItem[];
  locations: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { run, error, busy } = useAction();
  const approved = suppliers.filter((supplier) => supplier.status === "Approved");
  const [supplierId, setSupplierId] = useState(approved[0]?.id ?? "");
  const [outletId, setOutletId] = useState(locations[0]?.id ?? "");
  const [expectedDate, setExpectedDate] = useState(() => isoDaysFromNow(7).slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: number; unitCost: number }[]>([]);
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);

  async function save(submit: boolean) {
    if (await run("/api/purchase-orders", "POST", { supplierId, outletId, expectedDate, notes, submit, lines })) onClose();
  }

  return (
    <Modal open title="New purchase order" description="Only PCN-verified suppliers can be selected." onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Supplier">
            <SelectInput value={supplierId} onChange={(event) => setSupplierId(event.target.value)} options={approved.map((row) => ({ value: row.id, label: row.name }))} />
          </Field>
          <Field label="Deliver to">
            <SelectInput value={outletId} disabled={locations.length < 2} onChange={(event) => setOutletId(event.target.value)} options={locations.map((row) => ({ value: row.id, label: row.name }))} />
          </Field>
          <Field label="Expected delivery">
            <TextInput type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
          </Field>
        </div>

        <Field label="Add item">
          <SelectInput
            value=""
            onChange={(event) => {
              const item = catalog.find((row) => row.id === event.target.value);
              if (item && !lines.some((line) => line.productId === item.id)) setLines((current) => [...current, { productId: item.id, quantity: 50, unitCost: item.unitCost }]);
            }}
            options={[{ value: "", label: "Select an item…" }, ...catalog.map((row) => ({ value: row.id, label: `${row.name} · last cost ${money(row.unitCost)}` }))]}
          />
        </Field>

        <div className="space-y-2">
          {lines.length === 0 ? <p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-sm text-slate-500">No lines yet.</p> : null}
          {lines.map((line) => (
            <div key={line.productId} className="grid grid-cols-[1fr_90px_110px_100px_32px] items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2 text-sm">
              <span className="truncate text-white">{catalog.find((row) => row.id === line.productId)?.name}</span>
              <TextInput type="number" min={1} value={line.quantity} aria-label="Quantity" onChange={(event) => setLines((current) => current.map((row) => (row.productId === line.productId ? { ...row, quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)) } : row)))} />
              <TextInput type="number" min={1} value={line.unitCost} aria-label="Unit cost" onChange={(event) => setLines((current) => current.map((row) => (row.productId === line.productId ? { ...row, unitCost: Number(event.target.value) || 0 } : row)))} />
              <span className="text-right tabular-nums text-slate-200">{money(line.quantity * line.unitCost)}</span>
              <button type="button" onClick={() => setLines((current) => current.filter((row) => row.productId !== line.productId))} className="text-slate-500 hover:text-rose-300" aria-label="Remove line">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <Field label="Notes">
          <TextInput value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional — e.g. seasonal uplift, cold-chain delivery" />
        </Field>

        <FormError message={error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-300">Order value <span className="font-semibold text-white">{money(total)}</span></p>
          <div className="flex gap-2">
            <ActionButton tone="secondary" disabled={busy || !lines.length} onClick={() => void save(false)}>Save draft</ActionButton>
            <ActionButton disabled={busy || !lines.length} onClick={() => void save(true)}>
              <Send className="h-4 w-4" /> Submit for approval
            </ActionButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PurchaseOrderModal({
  order,
  locationName,
  actorId,
  permissions,
  onClose,
}: {
  order: PurchaseOrder;
  locationName: (id: string) => string;
  actorId: string;
  permissions: Permissions;
  onClose: () => void;
}) {
  const { run, error, busy } = useAction();
  const [receiving, setReceiving] = useState(false);
  const defaultExpiry = isoDaysFromNow(540).slice(0, 10);
  const [receipt, setReceipt] = useState(
    order.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity - line.receivedQuantity,
      batchNumber: "",
      expiryDate: defaultExpiry,
    })),
  );

  const ownOrder = order.createdById === actorId && !permissions.superAdmin;
  const canApprove = permissions.approve && order.status === "Pending approval" && !ownOrder;
  const canReceive = permissions.receive && (order.status === "Approved" || order.status === "Partially received");
  const canCancel = ["Draft", "Pending approval"].includes(order.status) ? permissions.approve || order.createdById === actorId : order.status === "Approved" && permissions.approve;
  const act = (action: string, lines?: unknown) => run(`/api/purchase-orders/${order.id}`, "PATCH", { action, lines });

  return (
    <Modal open title={order.number} description={`${order.supplierName} → ${locationName(order.outletId)}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-4">
          <Info label="Status"><StatusBadge status={order.status} /></Info>
          <Info label="Raised by">{order.createdBy}</Info>
          <Info label="Approved by">{order.approvedBy ?? "—"}</Info>
          <Info label="Expected">{shortDate(order.expectedDate)}</Info>
        </div>
        {order.notes ? <p className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">{order.notes}</p> : null}

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[560px]">
            <thead className="bg-slate-950/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">Unit cost</th>
                {receiving ? (<><th className="px-3 py-2">Receive qty</th><th className="px-3 py-2">Batch no.</th><th className="px-3 py-2">Expiry</th></>) : <th className="px-3 py-2 text-right">Value</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {order.lines.map((line, index) => (
                <tr key={line.productId}>
                  <td className="px-3 py-2 text-white">{line.productName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.receivedQuantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(line.unitCost)}</td>
                  {receiving ? (
                    <>
                      <td className="px-3 py-2"><TextInput type="number" min={0} max={line.quantity - line.receivedQuantity} value={receipt[index].quantity} onChange={(event) => setReceipt((current) => current.map((row, i) => (i === index ? { ...row, quantity: Math.max(0, Math.floor(Number(event.target.value) || 0)) } : row)))} className="w-20" /></td>
                      <td className="px-3 py-2"><TextInput value={receipt[index].batchNumber} placeholder="e.g. AMX-3520" onChange={(event) => setReceipt((current) => current.map((row, i) => (i === index ? { ...row, batchNumber: event.target.value } : row)))} className="w-32" /></td>
                      <td className="px-3 py-2"><TextInput type="date" value={receipt[index].expiryDate} onChange={(event) => setReceipt((current) => current.map((row, i) => (i === index ? { ...row, expiryDate: event.target.value } : row)))} className="w-40" /></td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-right tabular-nums text-white">{money(line.quantity * line.unitCost)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {receiving ? <p className="text-xs text-slate-400">Stock with under 6 months to expiry is rejected at receipt (short-dated goods policy).</p> : null}
        {ownOrder && order.status === "Pending approval" && permissions.approve ? <p className="text-xs text-amber-300">You raised this PO, so another approver must sign it off.</p> : null}

        <FormError message={error} />
        <div className="flex flex-wrap justify-between gap-2">
          <p className="self-center text-slate-300">Total <span className="font-semibold text-white">{money(order.total)}</span> · Paid {money(order.amountPaid)}</p>
          <div className="flex flex-wrap gap-2">
            {canCancel ? (
              <ActionButton tone="danger" disabled={busy} onClick={async () => (await act("cancel")) && onClose()}>
                <XCircle className="h-4 w-4" /> Cancel PO
              </ActionButton>
            ) : null}
            {order.status === "Draft" && (permissions.create && order.createdById === actorId) ? (
              <ActionButton disabled={busy} onClick={async () => (await act("submit")) && onClose()}>
                <Send className="h-4 w-4" /> Submit
              </ActionButton>
            ) : null}
            {canApprove ? (
              <ActionButton disabled={busy} onClick={async () => (await act("approve")) && onClose()}>
                <CheckCircle2 className="h-4 w-4" /> Approve
              </ActionButton>
            ) : null}
            {canReceive && !receiving ? (
              <ActionButton onClick={() => setReceiving(true)}>
                <PackageCheck className="h-4 w-4" /> Receive goods
              </ActionButton>
            ) : null}
            {receiving ? (
              <ActionButton disabled={busy} onClick={async () => (await act("receive", receipt)) && onClose()}>
                <PackageCheck className="h-4 w-4" /> Post GRN
              </ActionButton>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <div className="mt-1 text-slate-200">{children}</div>
    </div>
  );
}
