"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, Boxes, CheckCircle2, ClipboardCheck, PackageX, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { TabBar } from "@/components/erp/tabs";
import { useAction } from "@/components/erp/use-action";
import type { BatchRecord, StockMovement } from "@/lib/data";
import type { StockLedgerEntry, StockLedgerType } from "@/lib/erp/types";
import { compactMoney, dateTime, money, shortDate } from "@/lib/format";

type Item = {
  id: string;
  name: string;
  category: string;
  outletId: string;
  onHand: number;
  sellable: number;
  quarantined: number;
  minStock: number;
  costValue: number;
  status: string;
  controlled: boolean;
};
type BatchRow = BatchRecord & { days: number; state: string };
type Permissions = { request: boolean; approve: boolean; superAdmin: boolean };

const ADJUSTMENT_REASONS = ["Expired — destruction", "Damaged / broken", "Cold-chain breach", "Count variance", "Theft / loss", "NAFDAC recall"];

export function StockWorkspace({
  items,
  batches,
  movements,
  ledger,
  ledgerLabels,
  locations,
  actorName,
  scope,
  permissions,
}: {
  items: Item[];
  batches: BatchRow[];
  movements: StockMovement[];
  ledger: StockLedgerEntry[];
  ledgerLabels: Record<StockLedgerType, string>;
  locations: { id: string; name: string }[];
  actorName: string;
  scope?: string;
  permissions: Permissions;
}) {
  const params = useSearchParams();
  const [requesting, setRequesting] = useState(() => permissions.request && params?.get("adjust") === "1");
  const { run, error } = useAction();
  const loc = (id?: string) => (id ? locations.find((row) => row.id === id)?.name.replace(/^Outlet \d - /, "") ?? id : "—");
  const pending = movements.filter((row) => row.status === "Pending");
  const locationFilter = locations.length > 1 && !scope;

  const itemColumns: Column<Item>[] = [
    { key: "name", header: "Item", value: (row) => row.name, render: (row) => <div><p className="text-white">{row.name}{row.controlled ? <span className="ml-2 rounded bg-rose-500/15 px-1 text-[10px] text-rose-300">CD</span> : null}</p><p className="text-[11px] text-slate-500">{row.category}</p></div> },
    { key: "loc", header: "Location", value: (row) => loc(row.outletId), render: (row) => loc(row.outletId) },
    { key: "onHand", header: "On hand", value: (row) => row.onHand, align: "right", render: (row) => row.onHand.toLocaleString() },
    { key: "sellable", header: "Sellable", value: (row) => row.sellable, align: "right", render: (row) => <span className="text-emerald-300">{row.sellable.toLocaleString()}</span> },
    { key: "quarantine", header: "Quarantined", value: (row) => row.quarantined, align: "right", render: (row) => (row.quarantined ? <span className="text-rose-300">{row.quarantined}</span> : <span className="text-slate-600">0</span>) },
    { key: "min", header: "Reorder at", value: (row) => row.minStock, align: "right", render: (row) => row.minStock },
    { key: "value", header: "Cost value", value: (row) => row.costValue, align: "right", render: (row) => money(row.costValue) },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
  ];

  const batchColumns: Column<BatchRow>[] = [
    { key: "batch", header: "Batch", value: (row) => row.batchNumber, render: (row) => <span className="font-mono text-xs text-white">{row.batchNumber}</span> },
    { key: "item", header: "Item", value: (row) => row.productName, render: (row) => row.productName },
    { key: "loc", header: "Location", value: (row) => loc(row.assignedOutletId), render: (row) => loc(row.assignedOutletId) },
    { key: "supplier", header: "Supplier", value: (row) => row.supplier, render: (row) => <span className="text-slate-400">{row.supplier}</span> },
    { key: "received", header: "Received", value: (row) => row.receivingDate, render: (row) => <span className="text-slate-400">{shortDate(row.receivingDate)}</span> },
    { key: "expiry", header: "Expiry", value: (row) => row.expiryDate, render: (row) => <span className={row.days < 0 ? "text-rose-300" : row.days <= 120 ? "text-amber-300" : ""}>{shortDate(row.expiryDate)} <span className="text-[11px] text-slate-500">({row.days < 0 ? `${-row.days}d ago` : `${row.days}d`})</span></span> },
    { key: "qty", header: "Available", value: (row) => row.availableQuantity, align: "right", render: (row) => `${row.availableQuantity} / ${row.quantityReceived}` },
    { key: "state", header: "State", value: (row) => row.state, render: (row) => <StatusBadge status={row.state} /> },
  ];

  const ledgerColumns: Column<StockLedgerEntry>[] = [
    { key: "at", header: "Date", value: (row) => row.at, render: (row) => <span className="whitespace-nowrap text-xs text-slate-400">{dateTime(row.at)}</span> },
    { key: "ref", header: "Reference", value: (row) => row.reference, render: (row) => <span className="font-mono text-xs text-white">{row.reference}</span> },
    { key: "type", header: "Type", value: (row) => row.type, render: (row) => ledgerLabels[row.type] ?? row.type },
    { key: "item", header: "Item / batch", value: (row) => row.productName, render: (row) => <div><Link href={`/products/${row.productId}`} className="text-white hover:underline">{row.productName}</Link><p className="font-mono text-[11px] text-slate-500">{row.batchNumber}</p></div> },
    { key: "loc", header: "Location", value: (row) => loc(row.outletId), render: (row) => loc(row.outletId) },
    { key: "qty", header: "Qty (base)", value: (row) => row.baseQuantity, align: "right", render: (row) => <div><p className={row.baseQuantity < 0 ? "text-rose-300" : "text-emerald-300"}>{row.baseQuantity > 0 ? "+" : ""}{row.baseQuantity.toLocaleString()}</p>{row.unitsPerUnit > 1 ? <p className="text-[11px] text-slate-500">{row.quantity} {row.unit}</p> : null}</div> },
    { key: "bal", header: "Balance", value: (row) => row.newBalance, align: "right", render: (row) => <span className="text-xs tabular-nums text-slate-400">{row.previousBalance.toLocaleString()} → <span className="text-white">{row.newBalance.toLocaleString()}</span></span> },
    { key: "user", header: "User", value: (row) => row.userName, render: (row) => <span className="text-xs text-slate-400">{row.userName}</span> },
  ];

  const movementColumns: Column<StockMovement>[] = [
    { key: "ref", header: "Reference", value: (row) => row.reference, render: (row) => <span className="font-mono text-xs text-white">{row.reference}</span> },
    { key: "date", header: "Date", value: (row) => row.date, render: (row) => <span className="text-slate-400">{shortDate(row.date)}</span> },
    { key: "type", header: "Type", value: (row) => row.type, render: (row) => row.type },
    { key: "item", header: "Item", value: (row) => row.productName, render: (row) => <div><p className="text-white">{row.productName}</p>{row.reason ? <p className="text-[11px] text-slate-500">{row.reason}</p> : null}</div> },
    { key: "route", header: "From → to", value: (row) => loc(row.outletId), render: (row) => (row.toOutletId ? `${loc(row.outletId)} → ${loc(row.toOutletId)}` : loc(row.outletId)) },
    { key: "qty", header: "Qty", value: (row) => row.quantity, align: "right", render: (row) => {
        const inbound = row.type === "Receive" || row.type === "Return" || row.direction === "IN";
        return <span className={inbound ? "text-emerald-300" : "text-rose-300"}>{inbound ? "+" : "−"}{row.quantity}</span>;
      } },
    { key: "people", header: "Maker / checker", value: (row) => row.requestedBy ?? "", render: (row) => <span className="text-xs text-slate-400">{row.requestedBy ?? "—"} / {row.approvedBy ?? "—"}</span> },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "decide",
      header: "",
      render: (row) => {
        if (!permissions.approve || row.status !== "Pending") return null;
        if (row.requestedBy === actorName && !permissions.superAdmin) return <span className="text-[11px] text-slate-500">Needs another approver</span>;
        return (
          <div className="flex justify-end gap-1">
            <button type="button" title="Approve" onClick={() => void run(`/api/inventory/${row.id}`, "PATCH", { status: "Approved" })} className="rounded-lg p-1.5 text-emerald-300 hover:bg-emerald-500/10"><CheckCircle2 className="h-4 w-4" /></button>
            <button type="button" title="Reject" onClick={() => void run(`/api/inventory/${row.id}`, "PATCH", { status: "Rejected" })} className="rounded-lg p-1.5 text-rose-300 hover:bg-rose-500/10"><XCircle className="h-4 w-4" /></button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock control"
        description="Location stock, batch expiry and an approval-controlled movement ledger. Expired batches are quarantined and excluded from sellable stock."
        scope={scope}
        actions={
          permissions.request ? (
            <ActionButton onClick={() => setRequesting(true)}>
              <ArrowLeftRight className="h-4 w-4" /> Adjust / issue
            </ActionButton>
          ) : null
        }
      />

      <StatGrid
        stats={[
          { label: "Stock at cost", value: compactMoney(items.reduce((sum, row) => sum + row.costValue, 0)), note: `${items.length} item-location records`, icon: Boxes, tone: "emerald" },
          { label: "Pending approvals", value: String(pending.length), note: `${pending.filter((row) => row.type === "Transfer").length} transfers · ${pending.filter((row) => row.type === "Adjustment").length} adjustments`, icon: ClipboardCheck, tone: "amber" },
          { label: "Below reorder level", value: String(items.filter((row) => row.status === "LOW_STOCK").length), note: "Raise a PO from Purchase", icon: AlertTriangle, tone: "sky" },
          { label: "Quarantined units", value: items.reduce((sum, row) => sum + row.quarantined, 0).toLocaleString(), note: `${batches.filter((row) => row.state === "Expired" && row.availableQuantity > 0).length} expired batch(es) awaiting destruction`, icon: PackageX, tone: "rose" },
        ]}
      />

      <FormError message={error} />

      <Panel title="Inventory">
        <TabBar
          tabs={[
            {
              key: "ledger",
              label: "Stock ledger",
              count: ledger.length,
              content: (
                <DataTable
                  rows={ledger}
                  columns={ledgerColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.reference} ${row.productName} ${row.batchNumber} ${row.userName} ${row.remarks ?? ""}`}
                  filters={[
                    { key: "type", label: "Types", options: Object.entries(ledgerLabels).map(([value, label]) => ({ value, label })), get: (row) => row.type },
                    ...(locationFilter ? [{ key: "loc", label: "Locations", options: locations.map((row) => ({ value: row.id, label: row.name })), get: (row: StockLedgerEntry) => row.outletId }] : []),
                  ]}
                  exportName="stock-ledger"
                  dense
                />
              ),
            },
            {
              key: "movements",
              label: "Requests & approvals",
              count: movements.length,
              content: (
                <DataTable
                  rows={movements}
                  columns={movementColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.reference} ${row.productName} ${row.reason ?? ""} ${row.requestedBy ?? ""}`}
                  filters={[
                    { key: "status", label: "Statuses", options: ["Pending", "Approved", "Rejected"].map((value) => ({ value, label: value })), get: (row) => row.status },
                    { key: "type", label: "Types", options: ["Receive", "Issue", "Transfer", "Adjustment", "Return"].map((value) => ({ value, label: value })), get: (row) => row.type },
                    ...(locationFilter ? [{ key: "loc", label: "Locations", options: locations.map((row) => ({ value: row.id, label: row.name })), get: (row: StockMovement) => row.outletId }] : []),
                  ]}
                  exportName="stock-movements"
                  dense
                />
              ),
            },
            {
              key: "items",
              label: "Stock on hand",
              count: items.length,
              content: (
                <DataTable
                  rows={items}
                  columns={itemColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.name} ${row.category}`}
                  filters={[
                    ...(locationFilter ? [{ key: "loc", label: "Locations", options: locations.map((row) => ({ value: row.id, label: row.name })), get: (row: Item) => row.outletId }] : []),
                    { key: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "LOW_STOCK", label: "Low stock" }, { value: "RESTRICTED", label: "Restricted" }], get: (row) => row.status },
                  ]}
                  exportName="stock-on-hand"
                  dense
                />
              ),
            },
            {
              key: "batches",
              label: "Batches & expiry",
              count: batches.length,
              content: (
                <DataTable
                  rows={[...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))}
                  columns={batchColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.batchNumber} ${row.productName} ${row.supplier}`}
                  filters={[
                    { key: "state", label: "States", options: ["Expired", "Quarantined", "Near expiry", "Healthy"].map((value) => ({ value, label: value })), get: (row) => row.state },
                    ...(locationFilter ? [{ key: "loc", label: "Locations", options: locations.map((row) => ({ value: row.id, label: row.name })), get: (row: BatchRow) => row.assignedOutletId }] : []),
                  ]}
                  exportName="batches"
                  dense
                />
              ),
            },
          ]}
        />
      </Panel>

      {requesting ? <MovementModal items={items} batches={batches} locations={locations} onClose={() => setRequesting(false)} /> : null}
    </div>
  );
}

type MovementKind = "Issue" | "AdjustmentOut" | "AdjustmentIn" | "Return";

function MovementModal({ items, batches, locations, onClose }: { items: Item[]; batches: BatchRow[]; locations: { id: string; name: string }[]; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [kind, setKind] = useState<MovementKind>("AdjustmentOut");
  const [productId, setProductId] = useState(items[0]?.id ?? "");
  const item = items.find((row) => row.id === productId);
  const itemBatches = batches.filter((row) => row.productId === productId).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const [batchId, setBatchId] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [reason, setReason] = useState(ADJUSTMENT_REASONS[0]);
  const [note, setNote] = useState("");
  const needsBatch = kind === "AdjustmentIn";
  const allowsBatch = kind === "AdjustmentIn" || kind === "AdjustmentOut" || kind === "Return";

  return (
    <Modal open title="Request stock movement" description="Quantities are in the item's base unit. Requests stay Pending until approved by a different user, then post to the stock ledger." onClose={onClose}>
      <div className="grid gap-3">
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">Moving stock to another outlet? Use <Link href="/transfers" className="font-semibold underline">Stock Transfers</Link> (approval, dispatch and receipt).</p>
        <Field label="Movement type">
          <SelectInput
            value={kind}
            onChange={(event) => setKind(event.target.value as MovementKind)}
            options={[
              { value: "Issue", label: "Internal issue (ward, clinic, staff use)" },
              { value: "AdjustmentOut", label: "Write-off / negative adjustment" },
              { value: "AdjustmentIn", label: "Positive adjustment (count surplus)" },
              { value: "Return", label: "Return of issued stock" },
            ]}
          />
        </Field>
        <Field label="Item" hint={item ? `${item.onHand} on hand (${item.sellable} usable) at ${locations.find((row) => row.id === item.outletId)?.name}` : undefined}>
          <SelectInput
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              setBatchId("");
            }}
            options={items.map((row) => ({ value: row.id, label: `${row.name} — ${locations.find((loc) => loc.id === row.outletId)?.name ?? row.outletId}` }))}
          />
        </Field>
        {allowsBatch ? (
          <Field label={needsBatch ? "Batch" : "Batch (optional)"} hint={needsBatch ? "Counted stock is added to this batch." : "Leave blank to use expired batches first, then first-expiry-first-out."}>
            <SelectInput
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
              options={[{ value: "", label: needsBatch ? "Select batch" : "Automatic" }, ...itemBatches.map((row) => ({ value: row.id, label: `${row.batchNumber} · exp ${shortDate(row.expiryDate)} · ${row.availableQuantity} on hand${row.state !== "Healthy" ? ` · ${row.state}` : ""}` }))]}
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity"><TextInput type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
          {kind === "AdjustmentOut" ? (
            <Field label="Reason code"><SelectInput value={reason} onChange={(event) => setReason(event.target.value)} options={ADJUSTMENT_REASONS.map((value) => ({ value, label: value }))} /></Field>
          ) : null}
        </div>
        <Field label={kind === "AdjustmentOut" ? "Supporting note" : "Reason"}>
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="Details for the approver" />
        </Field>
        {item?.controlled ? <p className="text-xs text-rose-300">Controlled drug — this request is flagged on the compliance register.</p> : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy || !item || (needsBatch && !batchId)}
            onClick={async () => {
              const type = kind === "AdjustmentIn" || kind === "AdjustmentOut" ? "Adjustment" : kind;
              const fullReason = kind === "AdjustmentOut" ? `${reason}${note ? ` — ${note}` : ""}` : note;
              const ok = await run("/api/stock-movements", "POST", {
                type,
                productId,
                quantity: Math.floor(Number(quantity) || 0),
                direction: kind === "AdjustmentIn" ? "IN" : kind === "AdjustmentOut" ? "OUT" : undefined,
                batchId: allowsBatch && batchId ? batchId : undefined,
                reason: fullReason || ({ Issue: "Internal issue", AdjustmentIn: "Count surplus", AdjustmentOut: "Adjustment", Return: "Return of issued stock" } as const)[kind],
              });
              if (ok) onClose();
            }}
          >
            Submit request
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
