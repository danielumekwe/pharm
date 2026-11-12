"use client";

import { AlertTriangle, CheckCircle2, CloudOff, CreditCard, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { ActionButton, Field, FormError, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import type { DeviceView } from "@/lib/erp/offline-devices";
import type { OfflineOperationView } from "@/lib/erp/offline-reconcile";

type Payment = { saleId: string; number: string; localNumber: string; date: string; cashier: string; outletName: string; deviceName: string; total: number; tenders: { method: string; amount: number; reference?: string }[] };

const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-NG") : "—");
const naira = (value: number) => `₦${value.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const TYPE: Record<string, string> = { sale: "Sale", product: "New product", receiving: "Stock receipt", adjustment: "Stock adjustment" };
const STATUS: Record<string, { label: string; tone: "emerald" | "amber" | "rose" | "slate" | "sky" }> = {
  APPLIED: { label: "Applied", tone: "emerald" },
  CONFLICT: { label: "Conflict", tone: "amber" },
  REJECTED: { label: "Refused", tone: "rose" },
  RESOLVED: { label: "Resolved", tone: "sky" },
};

function Summary({ operation }: { operation: OfflineOperationView }) {
  const payload = (operation.payload ?? {}) as Record<string, unknown>;
  if (operation.type === "sale") {
    const lines = (payload.lines as { productName: string; quantity: number; packPrice: number }[] | undefined) ?? [];
    const totals = payload.totals as { total: number } | undefined;
    return (
      <div className="text-xs text-slate-300">
        {lines.map((line, index) => <p key={index}>{line.quantity} × {line.productName} @ {naira(line.packPrice)}</p>)}
        {totals ? <p className="font-medium text-white">Total {naira(totals.total)}</p> : null}
      </div>
    );
  }
  if (operation.type === "product") return <p className="text-xs text-slate-300">{String(payload.name ?? "")} · {String(payload.category ?? "")} · sells at {naira(Number(payload.sellingPrice ?? 0))}</p>;
  if (operation.type === "receiving") return <p className="text-xs text-slate-300">{String(payload.quantity)} {String(payload.packagingName)} × {String(payload.productName)} · batch {String(payload.batchNumber)} · exp {String(payload.expiryDate)}</p>;
  return <p className="text-xs text-slate-300">{payload.direction === "IN" ? "+" : "−"}{String(payload.quantity)} × {String(payload.productName)} · {String(payload.reason ?? "")}</p>;
}

export function ReconcileWorkspace({ operations, payments, devices, permissions, scope }: { operations: OfflineOperationView[]; payments: Payment[]; devices: DeviceView[]; permissions: { resolve: boolean; verify: boolean }; scope?: string }) {
  const [tab, setTab] = useState<"attention" | "payments" | "all">(operations.some((row) => row.status === "CONFLICT" || row.status === "REJECTED") ? "attention" : payments.length ? "payments" : "all");
  const [selected, setSelected] = useState<OfflineOperationView | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [note, setNote] = useState("");
  const action = useAction();
  const attention = useMemo(() => operations.filter((row) => row.status === "CONFLICT" || row.status === "REJECTED"), [operations]);
  const shown = tab === "attention" ? attention : operations;

  async function resolve(kind: "retry" | "close") {
    if (!selected) return;
    if (await action.run(`/api/offline/operations/${selected.id}`, "POST", { action: kind, note })) setSelected(null);
  }
  async function verify(outcome: "verified" | "not-received") {
    if (!payment) return;
    if (await action.run(`/api/offline/payments/${payment.saleId}`, "POST", { outcome, note })) setPayment(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory"
        title="Offline Sync & Reconciliation"
        description="Everything devices recorded without internet and uploaded later. Records that could not be applied automatically are kept here in full until someone retries or closes them; nothing is discarded or rewritten."
        scope={scope}
      />
      <StatGrid
        stats={[
          { label: "Need attention", value: String(attention.length), note: "Conflicts and refused records", tone: attention.length ? "amber" : "slate", icon: AlertTriangle },
          { label: "Payments to confirm", value: String(payments.length), note: "Card / transfer taken offline", tone: payments.length ? "amber" : "slate", icon: CreditCard },
          { label: "Applied automatically", value: String(operations.filter((row) => row.status === "APPLIED").length), note: "Last 500 uploads", tone: "emerald", icon: CheckCircle2 },
          { label: "Devices with unsent work", value: String(devices.length), note: devices.map((device) => `${device.name}: ${device.pendingCount}`).join(" · ") || "None reported", tone: devices.length ? "sky" : "slate", icon: CloudOff },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {([
          ["attention", `Needs attention (${attention.length})`],
          ["payments", `Payments to confirm (${payments.length})`],
          ["all", `All uploads (${operations.length})`],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-full border px-3 py-1 text-sm ${tab === key ? "border-blue-500 bg-blue-500/10 text-blue-200" : "border-slate-700 text-slate-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "payments" ? (
        <Panel title="Card and transfer payments taken offline" description="The cashier recorded these without a connection. Check them against the POS terminal settlement or bank statement.">
          {payments.length === 0 ? <p className="text-sm text-slate-400">Nothing to confirm.</p> : null}
          <ul className="divide-y divide-slate-800">
            {payments.map((row) => (
              <li key={row.saleId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium text-white">{row.number} <span className="text-slate-400">(offline {row.localNumber})</span></p>
                  <p className="text-xs text-slate-400">{when(row.date)} · {row.cashier} · {row.outletName} · {row.deviceName}</p>
                  <p className="text-xs text-slate-300">{row.tenders.map((tender) => `${tender.method} ${naira(tender.amount)}${tender.reference ? ` (ref ${tender.reference})` : ""}`).join(" + ")}</p>
                </div>
                {permissions.verify ? <ActionButton tone="secondary" onClick={() => { setPayment(row); setNote(""); action.setError(null); }}>Check payment</ActionButton> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Panel title={tab === "attention" ? "Records that need a decision" : "All offline uploads"}>
          {shown.length === 0 ? <p className="text-sm text-slate-400">{tab === "attention" ? "Nothing needs attention." : "No offline uploads yet."}</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm" data-offline-operations>
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Record</th>
                  <th className="py-2 pr-3">Made offline</th>
                  <th className="py-2 pr-3">Device / user</th>
                  <th className="py-2 pr-3">Details</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} onClick={() => { setSelected(row); setNote(""); action.setError(null); }} className="cursor-pointer border-b border-slate-800/60 align-top hover:bg-slate-800/40" data-operation-status={row.status}>
                    <td className="py-2 pr-3"><p className="font-medium text-white">{TYPE[row.type]}</p><p className="text-xs text-slate-400">{row.localReference ?? row.id.slice(0, 8)}{row.serverRef?.number ? ` → ${row.serverRef.number}` : ""}</p></td>
                    <td className="py-2 pr-3 text-slate-300">{when(row.createdOfflineAt)}<p className="text-xs text-slate-500">uploaded {when(row.receivedAt)}</p></td>
                    <td className="py-2 pr-3 text-slate-300">{row.deviceName}<p className="text-xs text-slate-500">{row.userName} · {row.outletName}</p></td>
                    <td className="py-2 pr-3"><Summary operation={row} /></td>
                    <td className="max-w-xs py-2 pr-3"><StatusBadge status={STATUS[row.status].label} tone={STATUS[row.status].tone} />{row.message && row.status !== "APPLIED" ? <p className="mt-1 text-xs text-amber-200">{row.message}</p> : null}{row.resolution ? <p className="mt-1 text-xs text-sky-200">{row.resolution}</p> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Modal open={Boolean(selected)} title={selected ? `${TYPE[selected.type]} ${selected.localReference ?? ""}` : ""} description={selected ? `${selected.deviceName} · ${selected.userName} · ${when(selected.createdOfflineAt)}` : undefined} onClose={() => setSelected(null)} wide>
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2"><StatusBadge status={STATUS[selected.status].label} tone={STATUS[selected.status].tone} /><span className="text-sm text-slate-300">{selected.message}</span></div>
            <Summary operation={selected} />
            <details className="rounded-lg border border-slate-800 p-3 text-xs text-slate-400">
              <summary className="cursor-pointer text-slate-300">Original record as made on the device</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(selected.payload, null, 2)}</pre>
            </details>
            {selected.resolution ? <p className="text-sm text-sky-200">{selected.resolution} ({when(selected.resolvedAt)})</p> : null}
            {permissions.resolve && (selected.status === "CONFLICT" || selected.status === "REJECTED") ? (
              <div className="space-y-3 border-t border-slate-800 pt-4">
                <p className="text-sm text-slate-300">
                  <strong className="text-white">Retry</strong> applies the record now through the normal rules, in {selected.userName}&apos;s name (for example after the missing stock was received or the price corrected). <strong className="text-white">Close</strong> settles it without applying it, e.g. the customer was refunded or stock was counted again; say what was done.
                </p>
                <Field label="Note (required to close; recorded in the audit log)">
                  <TextInput value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Refunded the customer ₦2,400; stock count corrected by ADJ-00031" />
                </Field>
                <FormError message={action.error} />
                <div className="flex flex-wrap justify-end gap-2">
                  <ActionButton tone="secondary" disabled={action.busy} onClick={() => resolve("retry")} data-retry><RotateCcw className="h-4 w-4" /> Retry now</ActionButton>
                  <ActionButton tone="danger" disabled={action.busy || note.trim().length < 10} onClick={() => resolve("close")} data-close><XCircle className="h-4 w-4" /> Close without applying</ActionButton>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(payment)} title={payment ? `Check payment for ${payment.number}` : ""} description={payment ? payment.tenders.map((tender) => `${tender.method} ${naira(tender.amount)}${tender.reference ? ` ref ${tender.reference}` : ""}`).join(" + ") : undefined} onClose={() => setPayment(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-300">Confirm the money arrived (terminal settlement or bank statement). If it did not, flag it: the sale stays as it is and the audit log records the follow-up.</p>
          <Field label="Note">
            <TextInput value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Seen on POS settlement 12 Nov" />
          </Field>
          <FormError message={action.error} />
          <div className="flex justify-end gap-2">
            <ActionButton tone="danger" disabled={action.busy || note.trim().length < 10} onClick={() => verify("not-received")}>Not received</ActionButton>
            <ActionButton disabled={action.busy} onClick={() => verify("verified")}>Confirm received</ActionButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
