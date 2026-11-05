"use client";

import { ArrowLeftRight, CheckCircle2, ClipboardCheck, PackageCheck, Plus, Send, Trash2, Truck, XCircle } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import type { StockTransfer } from "@/lib/erp/types";
import { dateTime, shortDate } from "@/lib/format";

type Row = StockTransfer & { fromName: string; toName: string };
type Item = { id: string; name: string; outletId: string; unit: string; usable: number };
type Actor = { id: string; outletIds: string[]; superAdmin: boolean; central: boolean };
type Permissions = { request: boolean; approve: boolean; receive: boolean };

const STEPS = ["Pending approval", "Approved", "Dispatched", "Received"] as const;
const tone = (status: string) => (status === "Received" ? "emerald" : status === "Rejected" || status === "Cancelled" ? "slate" : status === "Dispatched" || status === "Partially received" ? "sky" : "amber");

export function TransfersWorkspace({
  transfers,
  sources,
  destinations,
  items,
  actor,
  permissions,
  openNew,
  selectedId,
  scope,
}: {
  transfers: Row[];
  sources: { id: string; name: string }[];
  destinations: { id: string; name: string }[];
  items: Item[];
  actor: Actor;
  permissions: Permissions;
  openNew: boolean;
  selectedId: string | null;
  scope?: string;
}) {
  const [creating, setCreating] = useState(openNew && permissions.request);
  const [selected, setSelected] = useState<string | null>(selectedId);
  const current = transfers.find((row) => row.id === selected) ?? null;
  const open = transfers.filter((row) => !["Received", "Rejected", "Cancelled"].includes(row.status));

  const columns: Column<Row>[] = [
    { key: "ref", header: "Reference", value: (row) => row.reference, render: (row) => <button type="button" onClick={() => setSelected(row.id)} className="font-mono text-xs text-blue-600 hover:underline">{row.reference}</button> },
    { key: "date", header: "Requested", value: (row) => row.createdAt, render: (row) => <span className="text-xs text-slate-400">{dateTime(row.createdAt)}</span> },
    { key: "route", header: "From → to", value: (row) => `${row.fromName} ${row.toName}`, render: (row) => <span>{row.fromName.replace(/^Outlet \d - /, "")} <span className="text-slate-500">→</span> {row.toName.replace(/^Outlet \d - /, "")}</span> },
    { key: "items", header: "Items", value: (row) => row.lines.length, render: (row) => <span className="text-xs">{row.lines.map((line) => `${line.requested} × ${line.productName}`).join(", ")}</span> },
    { key: "by", header: "Requested by", value: (row) => row.createdBy, render: (row) => <span className="text-xs text-slate-400">{row.createdBy}</span> },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <div><StatusBadge status={row.status} tone={tone(row.status)} />{row.discrepancies.length ? <p className="mt-0.5 text-[11px] text-rose-300">Discrepancy recorded</p> : null}</div> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory & supply"
        title="Stock transfers"
        description="Transfers between outlets are explicit: the source requests, a manager approves, the source dispatches (stock leaves), and the destination confirms what arrived. Shortages are recorded as discrepancies."
        scope={scope}
        actions={permissions.request && sources.length ? <ActionButton onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New transfer</ActionButton> : null}
      />
      <StatGrid
        stats={[
          { label: "Awaiting approval", value: String(transfers.filter((row) => row.status === "Pending approval").length), note: "Needs a manager other than the requester", icon: ClipboardCheck, tone: "amber" },
          { label: "Ready to dispatch", value: String(transfers.filter((row) => row.status === "Approved").length), note: "Approved, still at the source", icon: Send, tone: "sky" },
          { label: "In transit", value: String(transfers.filter((row) => row.status === "Dispatched" || row.status === "Partially received").length), note: "Waiting for the destination to confirm", icon: Truck, tone: "emerald" },
          { label: "With discrepancies", value: String(transfers.filter((row) => row.discrepancies.length).length), note: `${open.length} transfer(s) open`, icon: ArrowLeftRight, tone: "rose" },
        ]}
      />
      <Panel title="Transfers">
        <DataTable
          rows={transfers}
          columns={columns}
          rowKey={(row) => row.id}
          search={(row) => `${row.reference} ${row.fromName} ${row.toName} ${row.lines.map((line) => line.productName).join(" ")}`}
          filters={[{ key: "status", label: "Statuses", options: ["Draft", "Pending approval", "Approved", "Dispatched", "Partially received", "Received", "Rejected", "Cancelled"].map((value) => ({ value, label: value })), get: (row) => row.status }]}
          exportName="stock-transfers"
          emptyMessage="No transfers yet."
        />
      </Panel>
      {creating ? <NewTransferModal sources={sources} destinations={destinations} items={items} onClose={() => setCreating(false)} /> : null}
      {current ? <TransferModal key={current.id + current.status} transfer={current} actor={actor} permissions={permissions} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function NewTransferModal({ sources, destinations, items, onClose }: { sources: { id: string; name: string }[]; destinations: { id: string; name: string }[]; items: Item[]; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [from, setFrom] = useState(sources[0]?.id ?? "");
  const [to, setTo] = useState(destinations.find((row) => row.id !== sources[0]?.id)?.id ?? "");
  const [lines, setLines] = useState<{ productId: string; quantity: string }[]>([{ productId: "", quantity: "" }]);
  const [notes, setNotes] = useState("");
  const available = items.filter((item) => item.outletId === from);
  async function save(submit: boolean) {
    const ok = await run("/api/transfers", "POST", { fromOutletId: from, toOutletId: to, notes, submit, lines: lines.filter((line) => line.productId && Number(line.quantity) > 0).map((line) => ({ productId: line.productId, quantity: Math.floor(Number(line.quantity)) })) });
    if (ok) onClose();
  }
  return (
    <Modal open title="New stock transfer" description="Quantities are in each item's base unit. Only in-date, non-quarantined stock can be transferred." onClose={onClose} wide>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From (source outlet)"><SelectInput value={from} disabled={sources.length < 2} onChange={(event) => { setFrom(event.target.value); setLines([{ productId: "", quantity: "" }]); }} options={sources.map((row) => ({ value: row.id, label: row.name }))} /></Field>
          <Field label="To (destination)"><SelectInput value={to} onChange={(event) => setTo(event.target.value)} options={destinations.filter((row) => row.id !== from).map((row) => ({ value: row.id, label: row.name }))} /></Field>
        </div>
        {lines.map((line, index) => {
          const item = available.find((row) => row.id === line.productId);
          return (
            <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <Field label={`Item ${index + 1}`}><SelectInput value={line.productId} onChange={(event) => setLines((current) => current.map((row, i) => (i === index ? { ...row, productId: event.target.value } : row)))} options={[{ value: "", label: available.length ? "Select item…" : "No usable stock at this outlet" }, ...available.filter((row) => row.id === line.productId || !lines.some((other) => other.productId === row.id)).map((row) => ({ value: row.id, label: `${row.name} · ${row.usable.toLocaleString()} ${row.unit} usable` }))]} /></Field>
              <Field label="Quantity" hint={item ? `max ${item.usable.toLocaleString()} ${item.unit}` : undefined}><TextInput type="number" min={1} value={line.quantity} onChange={(event) => setLines((current) => current.map((row, i) => (i === index ? { ...row, quantity: event.target.value } : row)))} /></Field>
              <button type="button" disabled={lines.length < 2} onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="mb-1 rounded-lg p-2 text-slate-400 hover:text-rose-300 disabled:opacity-30" aria-label="Remove line"><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
        <button type="button" onClick={() => setLines((current) => [...current, { productId: "", quantity: "" }])} className="flex items-center gap-1 justify-self-start text-sm font-medium text-blue-600"><Plus className="h-4 w-4" /> Add item</button>
        <Field label="Notes for the approver"><TextInput value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. Ikeja out of stock; weekend demand" /></Field>
        <FormError message={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone="secondary" disabled={busy || !to} onClick={() => void save(false)}>Save draft</ActionButton>
          <ActionButton disabled={busy || !to} onClick={() => void save(true)}><Send className="h-4 w-4" /> Submit for approval</ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function TransferModal({ transfer, actor, permissions, onClose }: { transfer: Row; actor: Actor; permissions: Permissions; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [note, setNote] = useState("");
  const atSource = actor.central || actor.outletIds.includes(transfer.fromOutletId);
  const atDestination = actor.central || actor.outletIds.includes(transfer.toOutletId);
  const outstanding = (line: Row["lines"][number], batchNumber: string) =>
    (line.dispatched.find((row) => row.batchNumber === batchNumber)?.quantity ?? 0) - line.received.filter((row) => row.batchNumber === batchNumber).reduce((sum, row) => sum + row.quantity, 0);
  const [received, setReceived] = useState<Record<string, string>>(() =>
    Object.fromEntries(transfer.lines.flatMap((line) => line.dispatched.map((batch) => [`${line.productId}|${batch.batchNumber}`, String(outstanding(line, batch.batchNumber))]))),
  );
  const [final, setFinal] = useState(true);
  const act = async (body: Record<string, unknown>) => (await run(`/api/transfers/${transfer.id}`, "PATCH", body)) && onClose();

  const canApprove = permissions.approve && transfer.status === "Pending approval" && (actor.superAdmin || transfer.createdById !== actor.id) && (actor.central || actor.outletIds.includes(transfer.fromOutletId));
  const canDispatch = permissions.request && transfer.status === "Approved" && atSource;
  const canReceive = permissions.receive && (transfer.status === "Dispatched" || transfer.status === "Partially received") && atDestination;
  const canCancel = ["Draft", "Pending approval", "Approved"].includes(transfer.status) && (transfer.createdById === actor.id || permissions.approve);
  const stepIndex = STEPS.indexOf(transfer.status as (typeof STEPS)[number]);
  const shortfall = transfer.lines.some((line) => line.dispatched.some((batch) => Number(received[`${line.productId}|${batch.batchNumber}`] || 0) < outstanding(line, batch.batchNumber)));

  return (
    <Modal open title={`Transfer ${transfer.reference}`} description={`${transfer.fromName} → ${transfer.toName} · requested by ${transfer.createdBy} ${dateTime(transfer.createdAt)}`} onClose={onClose} wide>
      <div className="grid gap-4">
        <ol className="grid grid-cols-4 gap-2 text-center text-[11px]">
          {STEPS.map((step, index) => (
            <li key={step} className={`rounded-lg border px-2 py-1.5 ${["Rejected", "Cancelled"].includes(transfer.status) ? "border-slate-800 text-slate-500" : index <= stepIndex || (transfer.status === "Partially received" && index <= 2) ? "border-blue-300 bg-blue-50 font-semibold text-blue-700" : "border-slate-800 text-slate-500"}`}>{step}</li>
          ))}
        </ol>
        {["Rejected", "Cancelled", "Draft", "Partially received"].includes(transfer.status) ? <StatusBadge status={transfer.status} tone={tone(transfer.status)} /> : null}

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-950 text-left text-[11px] uppercase tracking-[0.12em] text-slate-400">
              <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Requested</th><th className="px-3 py-2">Dispatched batches</th><th className="px-3 py-2 text-right">Received</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {transfer.lines.map((line) => (
                <tr key={line.productId}>
                  <td className="px-3 py-2 text-white">{line.productName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.requested.toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs">
                    {line.dispatched.length === 0 ? <span className="text-slate-500">Not dispatched</span> : line.dispatched.map((batch) => {
                      const k = `${line.productId}|${batch.batchNumber}`;
                      const left = outstanding(line, batch.batchNumber);
                      return (
                        <div key={batch.batchNumber} className="flex items-center gap-2 py-0.5">
                          <span className="font-mono">{batch.batchNumber}</span>
                          <span className="text-slate-500">exp {shortDate(batch.expiryDate)} · {batch.quantity}</span>
                          {canReceive && left > 0 ? (
                            <input type="number" min={0} max={left} value={received[k] ?? ""} onChange={(event) => setReceived((current) => ({ ...current, [k]: event.target.value }))} className="ml-auto h-7 w-20 rounded-md border border-slate-700 bg-slate-950 px-2 text-right" aria-label={`Received of ${batch.batchNumber}`} />
                          ) : null}
                        </div>
                      );
                    })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.received.reduce((sum, row) => sum + row.quantity, 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {transfer.discrepancies.length ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            <p className="font-semibold">Discrepancies</p>
            {transfer.discrepancies.map((row, index) => <p key={index}>{row.missing} × {row.productName} (batch {row.batchNumber}) not received — {row.note}</p>)}
          </div>
        ) : null}
        {transfer.notes ? <p className="text-sm text-slate-400">Notes: {transfer.notes}</p> : null}

        <details className="rounded-xl border border-slate-800 p-3 text-sm">
          <summary className="cursor-pointer text-slate-300">History ({transfer.history.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {transfer.history.map((row, index) => <li key={index}>{dateTime(row.at)} · <span className="text-white">{row.actor}</span> {row.action}{row.note ? ` — ${row.note}` : ""}</li>)}
          </ul>
        </details>

        {canApprove || canDispatch || canReceive || canCancel || (transfer.status === "Draft" && atSource) ? (
          <Field label={canReceive ? (shortfall ? "Discrepancy note (required if this is the final receipt)" : "Note (optional)") : "Note"}>
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder={canReceive ? "e.g. 2 bottles broken in transit" : canApprove ? "Reason (required to reject)" : ""} />
          </Field>
        ) : null}
        {canReceive && shortfall ? (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={final} onChange={(event) => setFinal(event.target.checked)} className="h-4 w-4 accent-blue-600" />
            This is the final receipt (record the shortfall as a discrepancy). Untick if more is still coming.
          </label>
        ) : null}
        <FormError message={error} />
        <div className="flex flex-wrap justify-end gap-2">
          {canCancel ? <ActionButton tone="ghost" disabled={busy} onClick={() => void act({ action: "cancel", note })}>Cancel transfer</ActionButton> : null}
          {transfer.status === "Draft" && atSource && permissions.request ? <ActionButton disabled={busy} onClick={() => void act({ action: "submit", note })}><Send className="h-4 w-4" /> Submit</ActionButton> : null}
          {canApprove ? (
            <>
              <ActionButton tone="danger" disabled={busy || note.trim().length < 3} onClick={() => void act({ action: "reject", note })}><XCircle className="h-4 w-4" /> Reject</ActionButton>
              <ActionButton disabled={busy} onClick={() => void act({ action: "approve", note })}><CheckCircle2 className="h-4 w-4" /> Approve</ActionButton>
            </>
          ) : null}
          {canDispatch ? <ActionButton disabled={busy} onClick={() => void act({ action: "dispatch", note })}><Truck className="h-4 w-4" /> Dispatch (stock leaves {transfer.fromName.replace(/^Outlet \d - /, "")})</ActionButton> : null}
          {canReceive ? (
            <ActionButton
              disabled={busy}
              onClick={() =>
                void act({
                  action: "receive",
                  note,
                  final,
                  lines: transfer.lines.flatMap((line) => line.dispatched.map((batch) => ({ productId: line.productId, batchNumber: batch.batchNumber, quantity: Math.max(0, Math.floor(Number(received[`${line.productId}|${batch.batchNumber}`] || 0))) }))),
                })
              }
            >
              <PackageCheck className="h-4 w-4" /> Confirm receipt
            </ActionButton>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
