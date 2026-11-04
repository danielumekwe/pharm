"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertOctagon,
  Archive,
  BellRing,
  CalendarClock,
  CheckCheck,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  PackageMinus,
  RefreshCw,
  Settings2,
  ShieldX,
  Store,
  Truck,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, inputClass, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { TabBar } from "@/components/erp/tabs";
import { useAction } from "@/components/erp/use-action";
import type { InventoryAlert, NotificationDelivery } from "@/lib/erp/types";
import { compactMoney, dateTime, money, shortDate } from "@/lib/format";

type Summary = {
  lowStock: number;
  outOfStock: number;
  expiredBatches: number;
  expiredValue: number;
  nearExpiry: number;
  nearExpiryProducts: number;
  criticalOutlets: { id: string; name: string; count: number }[];
  unacknowledged: number;
  showExpiry: boolean;
  recent: InventoryAlert[];
};
type Line = {
  id: string;
  product: string;
  outletId: string;
  outlet: string;
  uom: string;
  available: number;
  onHand: number;
  minStock: number;
  maxStock: number | null;
  thresholdSource: string;
  target: number;
  onOrder: number;
  suggested: number;
  level: string;
  alertId: string | null;
  alertStatus: string | null;
};
type BatchRow = {
  id: string;
  product: string;
  batchNumber: string;
  supplier: string;
  outletId: string;
  outlet: string;
  expiryDate: string;
  days: number;
  expired: boolean;
  window: number | null;
  quantity: number;
  value: number;
  disposition: string | null;
  dispositionNote: string | null;
  alertId: string | null;
  alertStatus: string | null;
};
type AlertRow = InventoryAlert & { outlet: string };
type Permissions = { manage: boolean; expiry: boolean; reports: boolean; stockRequest: boolean; central: boolean; deliveries: boolean };

const LEVEL_TONES: Record<string, "rose" | "amber" | "emerald" | "slate"> = { "Out of stock": "rose", Critical: "rose", Low: "amber", OK: "emerald" };
const TYPE_LABELS: Record<string, string> = { LOW_STOCK: "Low stock", EXPIRED: "Expired", NEAR_EXPIRY: "Near expiry" };
const DISPOSITION_LABELS: Record<string, string> = {
  QUARANTINED: "Quarantined",
  RETURN_PENDING: "Return awaiting approval",
  RETURNED: "Returned to supplier",
  DISPOSAL_PENDING: "Disposal awaiting approval",
  DISPOSED: "Disposed",
};
const short = (name: string) => name.replace(/^Outlet \d - /, "");

function AlertStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-600">—</span>;
  return <StatusBadge status={status === "OPEN" ? "New" : status === "ACKNOWLEDGED" ? "Acknowledged" : "Resolved"} tone={status === "OPEN" ? "rose" : status === "ACKNOWLEDGED" ? "amber" : "emerald"} />;
}

type AlertConfig = {
  lowStock: { defaultMin: number; outletMins: Record<string, number>; productMins: Record<string, number> };
  alertEmail: { enabled: boolean; recipients: string[]; notifyManagers: boolean; lowStockImmediate: boolean; criticalImmediate: boolean; dailySummary: boolean; maxRetries: number };
  productNames: string[];
};
const SOURCE_LABELS: Record<string, string> = { item: "Item", product: "Product rule", outlet: "Outlet rule", default: "Default" };

export function AlertsCentre(props: {
  initialTab?: string;
  initialQuery?: string;
  config: AlertConfig | null;
  summary: Summary;
  lines: Line[];
  batches: BatchRow[];
  alerts: AlertRow[];
  intervals: number[];
  outlets: { id: string; name: string }[];
  outletFilter: string | null;
  scope: string;
  reports: { key: string; title: string; description: string }[];
  deliveries: NotificationDelivery[];
  channels: { email: boolean; push: boolean; devices: number; lastDaily: string | null; lastMonthly: string | null; summaryHour: number };
  permissions: Permissions;
}) {
  const { summary, lines, batches, alerts, permissions, intervals } = props;
  const router = useRouter();
  const [modal, setModal] = useState<
    | { kind: "alert"; alert: AlertRow; action: "acknowledge" | "resolve" }
    | { kind: "threshold"; line: Line }
    | { kind: "batch"; batch: BatchRow; action: "quarantine" | "return" | "dispose" }
    | { kind: "history"; alert: AlertRow }
    | null
  >(null);
  const alertById = (id: string | null) => alerts.find((alert) => alert.id === id) ?? null;
  const low = lines.filter((line) => line.level !== "OK");
  const expired = batches.filter((batch) => batch.expired);
  const near = batches.filter((batch) => !batch.expired);

  function alertButtons(alertId: string | null) {
    const alert = alertById(alertId);
    if (!alert || !permissions.manage || alert.status === "RESOLVED") return null;
    return (
      <>
        {alert.status === "OPEN" ? (
          <IconAction label="Acknowledge" onClick={() => setModal({ kind: "alert", alert, action: "acknowledge" })}><Eye className="h-4 w-4" /></IconAction>
        ) : null}
        {alert.type !== "EXPIRED" ? (
          <IconAction label="Resolve" onClick={() => setModal({ kind: "alert", alert, action: "resolve" })}><CheckCheck className="h-4 w-4" /></IconAction>
        ) : null}
      </>
    );
  }

  const lowColumns: Column<Line>[] = [
    { key: "product", header: "Product", value: (row) => row.product, render: (row) => <span className="text-white">{row.product}</span> },
    { key: "outlet", header: "Outlet", value: (row) => row.outlet, render: (row) => short(row.outlet) },
    { key: "available", header: "Available", value: (row) => row.available, align: "right", render: (row) => <span className={row.available === 0 ? "font-semibold text-rose-300" : "text-white"}>{row.available.toLocaleString()} <span className="text-[11px] text-slate-500">{row.uom}</span></span> },
    { key: "min", header: "Minimum", value: (row) => row.minStock, align: "right", render: (row) => row.minStock.toLocaleString() },
    { key: "order", header: "On order", value: (row) => row.onOrder, align: "right", render: (row) => (row.onOrder ? <span className="text-sky-300">{row.onOrder}</span> : "—") },
    { key: "suggested", header: "Suggested reorder", value: (row) => row.suggested, align: "right", render: (row) => <span className="font-semibold text-emerald-300">{row.suggested.toLocaleString()}</span> },
    { key: "level", header: "Level", value: (row) => row.level, render: (row) => <StatusBadge status={row.level} tone={LEVEL_TONES[row.level]} /> },
    { key: "alert", header: "Alert", value: (row) => row.alertStatus ?? "", render: (row) => <AlertStatusBadge status={row.alertStatus} /> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end gap-0.5">
          {alertButtons(row.alertId)}
          {permissions.manage ? <IconAction label="Edit threshold" onClick={() => setModal({ kind: "threshold", line: row })}><Settings2 className="h-4 w-4" /></IconAction> : null}
          {row.alertId ? <IconAction label="History" onClick={() => setModal({ kind: "history", alert: alertById(row.alertId)! })}><History className="h-4 w-4" /></IconAction> : null}
        </div>
      ),
    },
  ];

  const batchBase: Column<BatchRow>[] = [
    { key: "product", header: "Product", value: (row) => row.product, render: (row) => <div><p className="text-white">{row.product}</p><p className="text-[11px] text-slate-500">{row.supplier}</p></div> },
    { key: "batch", header: "Batch", value: (row) => row.batchNumber, render: (row) => <span className="whitespace-nowrap font-mono text-xs">{row.batchNumber}</span> },
    { key: "expiry", header: "Expiry date", value: (row) => row.expiryDate, render: (row) => <span className="whitespace-nowrap">{shortDate(row.expiryDate)}</span> },
    { key: "days", header: "Days", value: (row) => row.days, align: "right", render: (row) => <span className={row.days < 0 ? "text-rose-300" : row.days <= 30 ? "text-amber-300" : ""}>{row.days < 0 ? `${-row.days} ago` : `${row.days} left`}</span> },
    { key: "qty", header: "Remaining", value: (row) => row.quantity, align: "right", render: (row) => row.quantity.toLocaleString() },
    { key: "outlet", header: "Outlet", value: (row) => row.outlet, render: (row) => short(row.outlet) },
    { key: "value", header: "Inventory value", value: (row) => row.value, align: "right", render: (row) => money(row.value) },
  ];

  const expiredColumns: Column<BatchRow>[] = [
    ...batchBase,
    {
      key: "handling",
      header: "Handling",
      value: (row) => row.disposition ?? "NONE",
      render: (row) => (row.disposition ? <StatusBadge status={DISPOSITION_LABELS[row.disposition]} tone={row.disposition.endsWith("PENDING") ? "amber" : "sky"} /> : <StatusBadge status="Not quarantined" tone="rose" />),
    },
    { key: "alert", header: "Alert", value: (row) => row.alertStatus ?? "", render: (row) => <AlertStatusBadge status={row.alertStatus} /> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end gap-0.5">
          {permissions.manage && !row.disposition ? <IconAction label="Quarantine" onClick={() => setModal({ kind: "batch", batch: row, action: "quarantine" })}><Archive className="h-4 w-4" /></IconAction> : null}
          {permissions.manage && permissions.stockRequest && (!row.disposition || row.disposition === "QUARANTINED") ? (
            <>
              <IconAction label="Return to supplier" onClick={() => setModal({ kind: "batch", batch: row, action: "return" })}><Truck className="h-4 w-4" /></IconAction>
              <IconAction label="Approved disposal" tone="rose" onClick={() => setModal({ kind: "batch", batch: row, action: "dispose" })}><Trash2 className="h-4 w-4" /></IconAction>
            </>
          ) : null}
          {alertButtons(row.alertId)}
          {row.alertId ? <IconAction label="History" onClick={() => setModal({ kind: "history", alert: alertById(row.alertId)! })}><History className="h-4 w-4" /></IconAction> : null}
        </div>
      ),
    },
  ];

  const nearColumns: Column<BatchRow>[] = [
    ...batchBase,
    { key: "window", header: "Window", value: (row) => row.window ?? 0, render: (row) => <StatusBadge status={`≤ ${row.window} days`} tone={row.window !== null && row.window <= intervals[intervals.length - 1] ? "rose" : row.window !== null && row.window <= 60 ? "amber" : "sky"} /> },
    { key: "actions", header: "", render: (row) => (row.alertId ? <div className="flex justify-end">{alertButtons(row.alertId)}<IconAction label="History" onClick={() => setModal({ kind: "history", alert: alertById(row.alertId)! })}><History className="h-4 w-4" /></IconAction></div> : null) },
  ];

  const thresholdColumns: Column<Line>[] = [
    { key: "product", header: "Product", value: (row) => row.product, render: (row) => <span className="text-white">{row.product}</span> },
    { key: "outlet", header: "Outlet", value: (row) => row.outlet, render: (row) => short(row.outlet) },
    { key: "available", header: "Available (in-date)", value: (row) => row.available, align: "right", render: (row) => <span>{row.available.toLocaleString()}{row.onHand > row.available ? <span className="ml-1 text-[11px] text-rose-300">(+{row.onHand - row.available} expired)</span> : null}</span> },
    { key: "min", header: "Minimum", value: (row) => row.minStock, align: "right", render: (row) => row.minStock.toLocaleString() },
    { key: "source", header: "Threshold from", value: (row) => row.thresholdSource, render: (row) => <span className={row.thresholdSource === "item" ? "text-white" : "text-sky-300"}>{SOURCE_LABELS[row.thresholdSource] ?? row.thresholdSource}</span> },
    { key: "target", header: "Target level", value: (row) => row.target, align: "right", render: (row) => <span>{row.target.toLocaleString()}{row.maxStock === null ? <span className="ml-1 text-[11px] text-slate-500">auto</span> : null}</span> },
    { key: "level", header: "Level", value: (row) => row.level, render: (row) => <StatusBadge status={row.level} tone={LEVEL_TONES[row.level]} /> },
    {
      key: "edit",
      header: "",
      render: (row) =>
        permissions.manage ? (
          <div className="flex justify-end gap-0.5">
            <IconAction label="Edit item threshold" onClick={() => setModal({ kind: "threshold", line: row })}><Settings2 className="h-4 w-4" /></IconAction>
            {row.thresholdSource === "item" ? <InheritButton productId={row.id} /> : null}
          </div>
        ) : null,
    },
  ];

  const logColumns: Column<AlertRow>[] = [
    { key: "type", header: "Type", value: (row) => row.type, render: (row) => <StatusBadge status={TYPE_LABELS[row.type]} tone={row.type === "EXPIRED" ? "rose" : row.type === "LOW_STOCK" ? "amber" : "sky"} /> },
    { key: "item", header: "Item", value: (row) => row.productName, render: (row) => <div><p className="text-white">{row.productName}</p>{row.batchNumber ? <p className="font-mono text-[11px] text-slate-500">{row.batchNumber}</p> : null}</div> },
    { key: "outlet", header: "Outlet", value: (row) => row.outlet, render: (row) => short(row.outlet) },
    { key: "severity", header: "Severity", value: (row) => row.severity, render: (row) => <StatusBadge status={row.severity} /> },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <AlertStatusBadge status={row.status} /> },
    { key: "created", header: "Detected", value: (row) => row.createdAt, render: (row) => <span className="whitespace-nowrap text-xs text-slate-400">{dateTime(row.createdAt)}</span> },
    { key: "last", header: "Last action", value: (row) => row.updatedAt, render: (row) => { const last = row.history[row.history.length - 1]; return <span className="text-xs text-slate-400">{last?.action} · {last?.actor}</span>; } },
    { key: "actions", header: "", render: (row) => <div className="flex justify-end">{alertButtons(row.id)}<IconAction label="History" onClick={() => setModal({ kind: "history", alert: row })}><History className="h-4 w-4" /></IconAction></div> },
  ];

  const tabs = [
    {
      key: "low",
      label: "Low stock",
      count: low.length,
      content: (
        <DataTable
          rows={low}
          columns={lowColumns}
          rowKey={(row) => row.id}
          search={(row) => `${row.product} ${row.outlet}`}
          initialQuery={props.initialTab === "low" ? props.initialQuery : ""}
          filters={[
            ...(props.outlets.length && !props.outletFilter ? [{ key: "outlet", label: "Outlets", options: props.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name })), get: (row: Line) => row.outletId }] : []),
            { key: "level", label: "Levels", options: ["Out of stock", "Critical", "Low"].map((value) => ({ value, label: value })), get: (row) => row.level },
            { key: "alert", label: "Alert states", options: [{ value: "OPEN", label: "New" }, { value: "ACKNOWLEDGED", label: "Acknowledged" }], get: (row) => row.alertStatus },
          ]}
          emptyMessage="No products are at or below their minimum stock."
          exportName="low-stock"
          dense
        />
      ),
    },
    ...(permissions.expiry
      ? [
          {
            key: "expired",
            label: "Expired batches",
            count: expired.length,
            content: (
              <div className="space-y-3">
                <p className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  <ShieldX className="mt-0.5 h-4 w-4 shrink-0" /> Expired batches are blocked automatically from POS sales, stock issues and transfers. Quarantine them, then record a return to the supplier or an approved disposal (a second person approves it on the Stock page).
                </p>
                <DataTable
                  rows={expired}
                  columns={expiredColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.product} ${row.batchNumber} ${row.supplier}`}
                  filters={[
                    ...(props.outlets.length && !props.outletFilter ? [{ key: "outlet", label: "Outlets", options: props.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name })), get: (row: BatchRow) => row.outletId }] : []),
                    { key: "handling", label: "Handling states", options: [{ value: "NONE", label: "Not quarantined" }, ...Object.entries(DISPOSITION_LABELS).map(([value, label]) => ({ value, label }))], get: (row) => row.disposition ?? "NONE" },
                  ]}
                  emptyMessage="No expired stock on hand."
                  exportName="expired-batches"
                  dense
                />
              </div>
            ),
          },
          {
            key: "near",
            label: "Near expiry",
            count: near.length,
            content: (
              <DataTable
                rows={[...near].sort((a, b) => a.days - b.days)}
                columns={nearColumns}
                rowKey={(row) => row.id}
                search={(row) => `${row.product} ${row.batchNumber}`}
                filters={[
                  { key: "window", label: "Windows", options: intervals.map((value) => ({ value: String(value), label: `≤ ${value} days` })), get: (row) => String(row.window) },
                  ...(props.outlets.length && !props.outletFilter ? [{ key: "outlet", label: "Outlets", options: props.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name })), get: (row: BatchRow) => row.outletId }] : []),
                ]}
                emptyMessage="No batches inside the warning windows."
                exportName="near-expiry"
                dense
              />
            ),
          },
        ]
      : []),
    {
      key: "thresholds",
      label: "Thresholds",
      count: lines.length,
      content: (
        <DataTable
          rows={lines}
          columns={thresholdColumns}
          rowKey={(row) => row.id}
          search={(row) => `${row.product} ${row.outlet}`}
          filters={props.outlets.length && !props.outletFilter ? [{ key: "outlet", label: "Outlets", options: props.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name })), get: (row: Line) => row.outletId }] : []}
          exportName="stock-thresholds"
          dense
        />
      ),
    },
    {
      key: "log",
      label: "Alert log",
      count: alerts.length,
      content: (
        <DataTable
          rows={alerts}
          columns={logColumns}
          rowKey={(row) => row.id}
          search={(row) => `${row.productName} ${row.batchNumber ?? ""} ${row.outlet}`}
          filters={[
            { key: "type", label: "Types", options: Object.entries(TYPE_LABELS).filter(([value]) => permissions.expiry || value === "LOW_STOCK").map(([value, label]) => ({ value, label })), get: (row) => row.type },
            { key: "status", label: "Statuses", options: [{ value: "OPEN", label: "New" }, { value: "ACKNOWLEDGED", label: "Acknowledged" }, { value: "RESOLVED", label: "Resolved" }], get: (row) => row.status },
            { key: "severity", label: "Severities", options: ["critical", "warning", "info"].map((value) => ({ value, label: value })), get: (row) => row.severity },
          ]}
          exportName="alert-log"
          pageSize={15}
          dense
        />
      ),
    },
    ...(props.config ? [{ key: "settings", label: "Notification settings", content: <NotificationSettings config={props.config} outlets={props.outlets} /> }] : []),
    ...(permissions.reports ? [{ key: "reports", label: "Reports", content: <ReportsPanel reports={props.reports} outlets={props.outlets} outletFilter={props.outletFilter} /> }] : []),
    ...(permissions.deliveries ? [{ key: "delivery", label: "Notifications", count: props.deliveries.length, content: <DeliveryPanel deliveries={props.deliveries} channels={props.channels} /> }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory monitoring"
        title="Inventory alerts & drug monitoring"
        description={`Low stock, expired and near-expiry batches from batch-level records. Warning windows: ${intervals.join(" / ")} days. Alerts are deduplicated and every action is recorded.`}
        scope={props.scope}
        actions={
          props.outlets.length ? (
            <select
              aria-label="Outlet"
              className={`${inputClass} w-auto`}
              value={props.outletFilter ?? "all"}
              onChange={(event) => router.push(`/alerts?outlet=${event.target.value}`)}
            >
              <option value="all">All outlets</option>
              {props.outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>{outlet.name}</option>
              ))}
            </select>
          ) : null
        }
      />

      <StatGrid
        stats={[
          { label: "Low-stock products", value: String(summary.lowStock), note: `${summary.outOfStock} out of stock · ${summary.unacknowledged} unacknowledged alert(s)`, icon: TrendingDown, tone: "amber" },
          { label: "Outlets with critical shortages", value: String(summary.criticalOutlets.length), note: summary.criticalOutlets.map((row) => `${short(row.name)} (${row.count})`).join(", ") || "None", icon: Store, tone: summary.criticalOutlets.length ? "rose" : "emerald" },
          ...(summary.showExpiry
            ? [
                { label: "Expired batches", value: String(summary.expiredBatches), note: `${compactMoney(summary.expiredValue)} at cost`, icon: AlertOctagon, tone: "rose" as const },
                { label: "Products approaching expiry", value: String(summary.nearExpiryProducts), note: `${summary.nearExpiry} batch(es) within ${intervals[0]} days`, icon: CalendarClock, tone: "sky" as const },
              ]
            : []),
        ]}
      />

      <Panel title="Monitoring" description={permissions.manage ? "Acknowledge to show the alert is being handled; resolve with a note once action is taken." : "Read-only: alerts relevant to your duties."}>
        <TabBar initial={props.initialTab} tabs={tabs} />
      </Panel>

      {modal?.kind === "alert" ? <AlertActionModal alert={modal.alert} action={modal.action} onClose={() => setModal(null)} /> : null}
      {modal?.kind === "threshold" ? <ThresholdModal line={modal.line} onClose={() => setModal(null)} /> : null}
      {modal?.kind === "batch" ? <BatchActionModal batch={modal.batch} action={modal.action} onClose={() => setModal(null)} /> : null}
      {modal?.kind === "history" ? <HistoryModal alert={modal.alert} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function IconAction({ label, tone, onClick, children }: { label: string; tone?: "rose"; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 ${tone === "rose" ? "hover:text-rose-300" : "hover:text-white"}`}>
      {children}
    </button>
  );
}

function AlertActionModal({ alert, action, onClose }: { alert: AlertRow; action: "acknowledge" | "resolve"; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [note, setNote] = useState("");
  return (
    <Modal open title={`${action === "acknowledge" ? "Acknowledge" : "Resolve"} alert`} description={`${TYPE_LABELS[alert.type]} · ${alert.productName}${alert.batchNumber ? ` · ${alert.batchNumber}` : ""} · ${alert.outlet}`} onClose={onClose}>
      <div className="grid gap-3">
        <Field label={action === "resolve" ? "What was done (required)" : "Note (optional)"}>
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === "resolve" ? "e.g. PO-2026-0151 raised for 200 packs" : "e.g. Checking warehouse stock"} />
        </Field>
        {action === "resolve" ? <p className="text-xs text-slate-500">If the stock is still below minimum, the alert stays resolved unless it gets worse (for example, runs out). Stock recovering above the minimum closes alerts automatically.</p> : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy || (action === "resolve" && note.trim().length < 5)} onClick={async () => (await run(`/api/alerts/${alert.id}`, "PATCH", { action, note })) && onClose()}>
            {action === "acknowledge" ? "Acknowledge" : "Resolve alert"}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function ThresholdModal({ line, onClose }: { line: Line; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [min, setMin] = useState(String(line.minStock));
  const [max, setMax] = useState(line.maxStock === null ? "" : String(line.maxStock));
  return (
    <Modal open title={`Stock thresholds · ${line.product}`} description={`${line.outlet} only. ${line.available} in-date ${line.uom} available now.`} onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum (reorder point)" hint="Alert when available stock reaches this level."><TextInput type="number" min={0} value={min} onChange={(event) => setMin(event.target.value)} /></Field>
          <Field label="Target level" hint={`Reorder up to this. Blank = 2 × minimum (${(Number(min) || 0) * 2}).`}><TextInput type="number" min={0} value={max} onChange={(event) => setMax(event.target.value)} /></Field>
        </div>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy} onClick={async () => (await run("/api/alerts/thresholds", "PATCH", { productId: line.id, minStock: Math.floor(Number(min) || 0), maxStock: max.trim() ? Math.floor(Number(max)) : null })) && onClose()}>
            Save thresholds
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function BatchActionModal({ batch, action, onClose }: { batch: BatchRow; action: "quarantine" | "return" | "dispose"; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [note, setNote] = useState("");
  const copy = {
    quarantine: { title: "Quarantine expired batch", body: "Record that the stock has been physically moved to the quarantine area. It is already blocked from sale.", label: "Quarantine location / note (optional)", placeholder: "e.g. Quarantine shelf Q2, sealed", button: "Record quarantine" },
    return: { title: "Return to supplier", body: `Raises a pending write-off of ${batch.quantity} unit(s) (${money(batch.value)}). On approval the batch is marked returned and ${batch.supplier} owes a credit note.`, label: "Supplier return authorisation (required)", placeholder: "e.g. RA-2026-1104 agreed with Kunle Ajayi", button: "Request return" },
    dispose: { title: "Approved disposal", body: `Raises a pending write-off of ${batch.quantity} unit(s) (${money(batch.value)}) for destruction. A different user approves it on the Stock page.`, label: "Disposal method & witness (required)", placeholder: "e.g. Incineration, witnessed by NAFDAC officer — cert. no. 4471", button: "Request disposal" },
  }[action];
  return (
    <Modal open title={copy.title} description={`${batch.product} · batch ${batch.batchNumber} · ${batch.outlet} · expired ${shortDate(batch.expiryDate)}`} onClose={onClose}>
      <div className="grid gap-3">
        <p className="text-sm text-slate-300">{copy.body}</p>
        <Field label={copy.label}><TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder={copy.placeholder} /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone={action === "dispose" ? "danger" : "primary"} disabled={busy || (action !== "quarantine" && note.trim().length < 3)} onClick={async () => (await run(`/api/alerts/batches/${batch.id}`, "POST", { action, note })) && onClose()}>
            {action === "quarantine" ? <Archive className="h-4 w-4" /> : action === "return" ? <Truck className="h-4 w-4" /> : <PackageMinus className="h-4 w-4" />} {copy.button}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ alert, onClose }: { alert: AlertRow; onClose: () => void }) {
  return (
    <Modal open title="Alert history" description={`${TYPE_LABELS[alert.type]} · ${alert.productName}${alert.batchNumber ? ` · ${alert.batchNumber}` : ""} · ${alert.outlet}`} onClose={onClose}>
      <ol className="space-y-2 text-sm">
        {[...alert.history].reverse().map((entry, index) => (
          <li key={index} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
            <p className="font-medium capitalize text-white">{entry.action}</p>
            {entry.note ? <p className="text-slate-300">{entry.note}</p> : null}
            <p className="mt-0.5 text-[11px] text-slate-500">{dateTime(entry.at)} · {entry.actor}</p>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

type ReportPreview = { title: string; description: string; scopeLabel: string; filtersLabel: string; columns: { key: string; header: string; type: string }[]; rows: Record<string, string | number>[]; totals: Record<string, number> };

function ReportsPanel({ reports, outlets, outletFilter }: { reports: { key: string; title: string; description: string }[]; outlets: { id: string; name: string }[]; outletFilter: string | null }) {
  const [form, setForm] = useState({ kind: reports[0]?.key ?? "low-stock", outlet: outletFilter ?? "all", product: "", batch: "", from: "", to: "" });
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = (format: string, kind = form.kind) => {
    const params = new URLSearchParams({ kind, format });
    if (outlets.length) params.set("outlet", form.outlet);
    for (const key of ["product", "batch", "from", "to"] as const) if (form[key]) params.set(key, form[key]);
    return `/api/inventory-reports?${params.toString()}`;
  };
  const format = (value: string | number | undefined, type: string) =>
    value === undefined ? "" : type === "money" ? money(Number(value)) : type === "number" ? Number(value).toLocaleString() : type === "percent" ? `${Number(value).toFixed(1)}%` : type === "date" ? shortDate(String(value)) : String(value);

  async function load() {
    setBusy(true);
    setError(null);
    const response = await fetch(query("json"));
    const payload = (await response.json().catch(() => ({}))) as ReportPreview & { error?: string };
    setBusy(false);
    if (!response.ok) return setError(payload.error ?? "Could not load the report.");
    setPreview(payload);
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const current = reports.find((report) => report.key === form.kind);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Field label="Report" className="md:col-span-2"><SelectInput value={form.kind} onChange={(event) => { set("kind")(event); setPreview(null); }} options={reports.map((report) => ({ value: report.key, label: report.title }))} /></Field>
        {outlets.length ? <Field label="Outlet"><SelectInput value={form.outlet} onChange={set("outlet")} options={[{ value: "all", label: "All outlets" }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]} /></Field> : null}
        <Field label="Product contains"><TextInput value={form.product} onChange={set("product")} /></Field>
        <Field label="Batch contains"><TextInput value={form.batch} onChange={set("batch")} /></Field>
        <Field label="Expiry from"><TextInput type="date" value={form.from} onChange={set("from")} /></Field>
        <Field label="Expiry to"><TextInput type="date" value={form.to} onChange={set("to")} /></Field>
      </div>
      <p className="text-xs text-slate-500">{current?.description} Date filters apply to batch expiry dates; stock-level reports are as at now.</p>
      <div className="flex flex-wrap gap-2">
        <ActionButton disabled={busy} onClick={() => void load()}><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Preview</ActionButton>
        <a href={query("pdf")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800"><FileText className="h-4 w-4" /> PDF</a>
        <a href={query("xlsx")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800"><FileSpreadsheet className="h-4 w-4" /> Excel</a>
        <a href={query("xlsx", "all")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800"><FileSpreadsheet className="h-4 w-4" /> All 6 reports (Excel)</a>
      </div>
      <FormError message={error} />
      {preview ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-300"><span className="font-semibold text-white">{preview.title}</span> · {preview.scopeLabel} · {preview.filtersLabel} · {preview.rows.length} line(s)</p>
          <DataTable
            rows={preview.rows.map((row, index) => ({ ...row, __id: String(index) }))}
            columns={preview.columns.map((column) => ({
              key: column.key,
              header: column.header,
              value: (row: Record<string, string | number>) => row[column.key],
              align: column.type === "text" || column.type === "date" ? undefined : ("right" as const),
              render: (row: Record<string, string | number>) => format(row[column.key], column.type),
            }))}
            rowKey={(row) => String(row.__id)}
            emptyMessage="No records match this report."
            dense
          />
          {Object.keys(preview.totals).length && preview.rows.length ? (
            <p className="text-xs text-slate-400">Totals: {preview.columns.filter((column) => column.key in preview.totals).map((column) => `${column.header} ${format(preview.totals[column.key], column.type)}`).join(" · ")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DeliveryPanel({ deliveries, channels }: { deliveries: NotificationDelivery[]; channels: { email: boolean; push: boolean; devices: number; lastDaily: string | null; lastMonthly: string | null; summaryHour: number } }) {
  const { run, error, busy } = useAction();
  const [result, setResult] = useState<string | null>(null);
  const columns: Column<NotificationDelivery>[] = [
    { key: "at", header: "Time", value: (row) => row.at, render: (row) => <span className="whitespace-nowrap text-xs text-slate-400">{dateTime(row.at)}</span> },
    { key: "channel", header: "Channel", value: (row) => row.channel, render: (row) => row.channel.replace("_", "-").toLowerCase() },
    { key: "to", header: "Recipient", value: (row) => row.recipientName, render: (row) => row.recipientName },
    { key: "subject", header: "Message", value: (row) => row.subject, render: (row) => <div><p className="text-white">{row.subject}</p><p className="text-[11px] text-slate-500">{row.event}</p></div> },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} tone={row.status === "SENT" ? "emerald" : row.status === "SKIPPED" ? "slate" : "rose"} /> },
    { key: "detail", header: "Detail", value: (row) => row.detail, render: (row) => <span className="text-xs text-slate-400">{row.detail}</span> },
  ];
  const job = async (name: "scan" | "daily" | "monthly") => {
    const payload = await run<{ recipients?: number; alreadySent?: number; created?: number }>("/api/alerts/jobs", "POST", { job: name });
    if (payload) {
      setResult(
        name === "scan"
          ? `Scan complete: ${payload.created ?? 0} new alert(s).`
          : `Sent to ${payload.recipients ?? 0} recipient(s)${payload.alreadySent ? `; ${payload.alreadySent} already received ${name === "daily" ? "today's summary" : "this month's report"} (not sent twice)` : ""}.`,
      );
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <ChannelCard label="In-app" ok detail="Bell icon in the header, live for every user" />
        <ChannelCard label="Email" ok={channels.email} detail={channels.email ? "SMTP configured" : "Not configured — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_FROM"} />
        <ChannelCard label="Android push" ok={channels.push} detail={`${channels.push ? "Firebase configured" : "Not configured — set FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY"} · ${channels.devices} device(s) registered`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ActionButton tone="secondary" disabled={busy} onClick={() => void job("scan")}><RefreshCw className="h-4 w-4" /> Scan now</ActionButton>
        <ActionButton tone="secondary" disabled={busy} onClick={() => void job("daily")}><BellRing className="h-4 w-4" /> Send daily summary now</ActionButton>
        <ActionButton tone="secondary" disabled={busy} onClick={() => void job("monthly")}><FileSpreadsheet className="h-4 w-4" /> Send monthly report now</ActionButton>
        <span className="text-xs text-slate-500">Scheduled: daily at {String(channels.summaryHour).padStart(2, "0")}:00 (last {channels.lastDaily ?? "never"}), monthly on the 1st (last {channels.lastMonthly ?? "never"}).</span>
      </div>
      {result ? <p className="text-sm text-emerald-300">{result}</p> : null}
      <FormError message={error} />
      <DataTable
        rows={deliveries}
        columns={columns}
        rowKey={(row) => row.id}
        search={(row) => `${row.recipientName} ${row.subject} ${row.event}`}
        filters={[
          { key: "channel", label: "Channels", options: [{ value: "IN_APP", label: "In-app" }, { value: "EMAIL", label: "Email" }, { value: "PUSH", label: "Push" }], get: (row) => row.channel },
          { key: "status", label: "Statuses", options: ["SENT", "SKIPPED", "FAILED"].map((value) => ({ value, label: value })), get: (row) => row.status },
        ]}
        emptyMessage="No notifications sent yet."
        exportName="notification-history"
        dense
      />
      <p className="text-xs text-slate-500">
        Each alert event notifies each recipient once. Staff see stock-availability alerts in-app; email and push go to people who manage alerts. Android devices register via <Link href="/api/devices" className="text-emerald-300">POST /api/devices</Link>.
      </p>
    </div>
  );
}

function ChannelCard({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
      <div className="flex items-center justify-between"><span className="font-medium text-white">{label}</span><StatusBadge status={ok ? "Active" : "Not configured"} tone={ok ? "emerald" : "slate"} /></div>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function InheritButton({ productId }: { productId: string }) {
  const { run, busy } = useAction();
  return (
    <button type="button" disabled={busy} title="Use inherited threshold (product / outlet / default rule)" onClick={() => void run("/api/alerts/thresholds", "PATCH", { productId, inherit: true })} className="rounded-lg px-1.5 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white">
      Use inherited
    </button>
  );
}

function NotificationSettings({ config, outlets }: { config: AlertConfig; outlets: { id: string; name: string }[] }) {
  const { run, error, busy } = useAction();
  const [email, setEmail] = useState({ ...config.alertEmail, recipientsText: config.alertEmail.recipients.join("\n") });
  const [defaultMin, setDefaultMin] = useState(String(config.lowStock.defaultMin));
  const [outletMins, setOutletMins] = useState<Record<string, string>>(Object.fromEntries(outlets.map((outlet) => [outlet.id, config.lowStock.outletMins[outlet.id] !== undefined ? String(config.lowStock.outletMins[outlet.id]) : ""])));
  const [productRule, setProductRule] = useState({ product: config.productNames[0] ?? "", value: "" });
  const [saved, setSaved] = useState<string | null>(null);
  const toggle = (key: "enabled" | "notifyManagers" | "lowStockImmediate" | "criticalImmediate" | "dailySummary", label: string, hint: string) => (
    <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-green-700" checked={email[key]} onChange={(event) => setEmail((current) => ({ ...current, [key]: event.target.checked }))} />
      <span><span className="font-medium text-white">{label}</span><span className="block text-xs text-slate-400">{hint}</span></span>
    </label>
  );
  const rule = async (scope: "default" | "outlet" | "product", key: string, value: string) => {
    const result = await run<{ changed: number }>("/api/alerts/config", "PATCH", { action: "rule", scope, key, value: value.trim() === "" ? null : Math.floor(Number(value)) });
    if (result) setSaved(`Threshold rule saved — ${result.changed} inherited item(s) updated.`);
  };

  return (
    <div className="space-y-6">
      {saved ? <p className="text-sm text-emerald-300">{saved}</p> : null}
      <FormError message={error} />
      <section className="space-y-3">
        <h5 className="font-semibold text-white">Email notifications</h5>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {toggle("enabled", "Email notifications", "Master switch for all inventory alert emails.")}
          {toggle("lowStockImmediate", "Low-stock emails", "Email as soon as an item reaches or falls below its minimum.")}
          {toggle("criticalImmediate", "Immediate critical alerts", "Critical shortages and newly expired batches.")}
          {toggle("dailySummary", "Daily inventory summary", "Scheduled summary each morning.")}
          {toggle("notifyManagers", "Include outlet managers", "Also email users who manage alerts for the affected outlet.")}
        </div>
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field label="Additional recipients (one per line)" hint="E.g. procurement@ or the superintendent pharmacist. Up to 25.">
            <textarea value={email.recipientsText} onChange={(event) => setEmail((current) => ({ ...current, recipientsText: event.target.value }))} rows={4} className={`${inputClass} h-auto py-2`} />
          </Field>
          <Field label="Retries for failed emails" hint="Exponential backoff: 2, 4, 8 … minutes.">
            <TextInput type="number" min={0} max={10} value={email.maxRetries} onChange={(event) => setEmail((current) => ({ ...current, maxRetries: Math.floor(Number(event.target.value) || 0) }))} />
          </Field>
        </div>
        <ActionButton
          disabled={busy}
          onClick={async () => {
            const { recipientsText, ...rest } = email;
            const result = await run("/api/alerts/config", "PATCH", { action: "email", ...rest, recipients: recipientsText.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean) });
            if (result) setSaved("Email settings saved.");
          }}
        >
          Save email settings
        </ActionButton>
      </section>

      <section className="space-y-3">
        <h5 className="font-semibold text-white">Low-stock threshold rules</h5>
        <p className="text-xs text-slate-400">Precedence: item-specific (set per item on the Thresholds tab) → product rule → outlet rule → default. Items with an item-specific value are not changed by rules; use “Use inherited” to switch them back.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Default minimum (all items)"><TextInput type="number" min={0} value={defaultMin} onChange={(event) => setDefaultMin(event.target.value)} className="w-32" /></Field>
          <ActionButton tone="secondary" disabled={busy} onClick={() => void rule("default", "default", defaultMin)}>Save default</ActionButton>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {outlets.map((outlet) => (
            <div key={outlet.id} className="flex items-end gap-2">
              <Field label={`${outlet.name}`} className="flex-1" hint="Blank = no outlet rule"><TextInput type="number" min={0} value={outletMins[outlet.id] ?? ""} onChange={(event) => setOutletMins((current) => ({ ...current, [outlet.id]: event.target.value }))} /></Field>
              <ActionButton tone="secondary" disabled={busy} onClick={() => void rule("outlet", outlet.id, outletMins[outlet.id] ?? "")}>Save</ActionButton>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Product rule (all outlets)"><SelectInput value={productRule.product} onChange={(event) => setProductRule((current) => ({ ...current, product: event.target.value }))} options={config.productNames.map((name) => ({ value: name, label: `${name}${config.lowStock.productMins[name] !== undefined ? ` (currently ${config.lowStock.productMins[name]})` : ""}` }))} /></Field>
          <Field label="Minimum" hint="Blank = remove rule"><TextInput type="number" min={0} value={productRule.value} onChange={(event) => setProductRule((current) => ({ ...current, value: event.target.value }))} className="w-28" /></Field>
          <ActionButton tone="secondary" disabled={busy || !productRule.product} onClick={() => void rule("product", productRule.product, productRule.value)}>Save product rule</ActionButton>
        </div>
      </section>
    </div>
  );
}
