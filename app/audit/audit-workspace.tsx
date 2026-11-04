"use client";

import { AlertOctagon, FileWarning, ShieldAlert, ShieldCheck } from "lucide-react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { TabBar } from "@/components/erp/tabs";
import type { AuditEvent } from "@/lib/erp/types";
import { compactMoney, dateTime, money, shortDate } from "@/lib/format";

type EventRow = AuditEvent & { outlet: string };
type BatchRow = { id: string; batchNumber: string; productName: string; outlet: string; expiryDate: string; days: number; quantity: number; value: number };
type ControlledRow = { id: string; date: string; document: string; outlet: string; patient: string; prescription: string; detail: string; status: string };

const MODULES = ["auth", "sale", "purchase", "stock", "finance", "contacts", "users", "products", "compliance"];

export function AuditWorkspace({
  events,
  expired,
  nearExpiry,
  quarantineValue,
  controlledRegister,
  controlledStock,
  unregistered,
  unverifiedSuppliers,
  rxItems,
}: {
  events: EventRow[];
  expired: BatchRow[];
  nearExpiry: BatchRow[];
  quarantineValue: number;
  controlledRegister: ControlledRow[];
  controlledStock: { id: string; name: string; outlet: string; stock: number }[];
  unregistered: { id: string; name: string; manufacturer: string; outlet: string }[];
  unverifiedSuppliers: { id: string; name: string; status: string; pcn: string }[];
  rxItems: number;
}) {
  const issues = expired.length + unregistered.length + unverifiedSuppliers.length + controlledRegister.filter((row) => row.prescription === "MISSING").length;
  const score = Math.max(0, 100 - expired.length * 8 - unregistered.length * 4 - unverifiedSuppliers.length * 3);

  const eventColumns: Column<EventRow>[] = [
    { key: "at", header: "Time", value: (row) => row.at, render: (row) => <span className="whitespace-nowrap text-slate-400">{dateTime(row.at)}</span> },
    { key: "actor", header: "User", value: (row) => row.actorName, render: (row) => <div><p className="text-white">{row.actorName}</p><p className="text-[11px] text-slate-500">{row.actorRole.replace(/_/g, " ")}</p></div> },
    { key: "action", header: "Action", value: (row) => row.action, render: (row) => <span className="font-mono text-xs text-sky-300">{row.action}</span> },
    { key: "summary", header: "Details", value: (row) => row.summary, render: (row) => <span className="text-slate-200">{row.summary}</span>, className: "max-w-md" },
    { key: "outlet", header: "Location", value: (row) => row.outlet, render: (row) => <span className="text-slate-400">{row.outlet.replace(/^Outlet \d - /, "")}</span> },
    { key: "severity", header: "Severity", value: (row) => row.severity, render: (row) => <StatusBadge status={row.severity} /> },
  ];

  const batchColumns: Column<BatchRow>[] = [
    { key: "batch", header: "Batch", value: (row) => row.batchNumber, render: (row) => <span className="font-mono text-xs text-white">{row.batchNumber}</span> },
    { key: "item", header: "Item", value: (row) => row.productName, render: (row) => row.productName },
    { key: "loc", header: "Location", value: (row) => row.outlet, render: (row) => row.outlet },
    { key: "exp", header: "Expiry", value: (row) => row.expiryDate, render: (row) => <span className={row.days < 0 ? "text-rose-300" : "text-amber-300"}>{shortDate(row.expiryDate)} ({row.days < 0 ? `${-row.days}d overdue` : `${row.days}d left`})</span> },
    { key: "qty", header: "Units", value: (row) => row.quantity, align: "right", render: (row) => row.quantity },
    { key: "value", header: "Cost value", value: (row) => row.value, align: "right", render: (row) => money(row.value) },
  ];

  const controlledColumns: Column<ControlledRow>[] = [
    { key: "date", header: "Date", value: (row) => row.date, render: (row) => <span className="text-slate-400">{dateTime(row.date)}</span> },
    { key: "doc", header: "Invoice", value: (row) => row.document, render: (row) => <span className="font-mono text-xs">{row.document}</span> },
    { key: "outlet", header: "Outlet", value: (row) => row.outlet, render: (row) => row.outlet },
    { key: "patient", header: "Patient / customer", value: (row) => row.patient, render: (row) => row.patient },
    { key: "rx", header: "Prescription", value: (row) => row.prescription, render: (row) => <span className={row.prescription === "MISSING" ? "text-rose-300" : "font-mono text-xs"}>{row.prescription}</span> },
    { key: "detail", header: "Dispensed", value: (row) => row.detail, render: (row) => <span className="text-white">{row.detail}</span> },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governance"
        title="Audit & compliance"
        description="Immutable activity trail with PCN / NAFDAC compliance checks: expired-stock quarantine, controlled-drug register, product registration and supplier licensing."
      />

      <StatGrid
        stats={[
          { label: "Compliance score", value: `${score}%`, note: `${issues} open issue(s)`, icon: ShieldCheck, tone: score >= 85 ? "emerald" : score >= 70 ? "amber" : "rose" },
          { label: "Expired in stock", value: String(expired.length), note: `${compactMoney(quarantineValue)} to quarantine & destroy`, icon: AlertOctagon, tone: "rose" },
          { label: "Expiring ≤ 120 days", value: String(nearExpiry.length), note: "Prioritise for sale or return to supplier", icon: FileWarning, tone: "amber" },
          { label: "Controlled & Rx items", value: `${controlledStock.length} / ${rxItems}`, note: `${controlledRegister.length} controlled dispensing record(s)`, icon: ShieldAlert, tone: "sky" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Registration & licensing gaps" description="Items without a NAFDAC number cannot be legally sold; unverified suppliers are blocked from POs.">
          <ul className="space-y-2 text-sm">
            {unregistered.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <span><span className="text-white">{row.name}</span> <span className="text-slate-500">· {row.manufacturer} · {row.outlet}</span></span>
                <StatusBadge status="NAFDAC pending" tone="amber" />
              </li>
            ))}
            {unverifiedSuppliers.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <span><span className="text-white">{row.name}</span> <span className="font-mono text-xs text-slate-500">· {row.pcn}</span></span>
                <StatusBadge status={row.status} />
              </li>
            ))}
            {unregistered.length + unverifiedSuppliers.length === 0 ? <li className="text-slate-500">No gaps found.</li> : null}
          </ul>
        </Panel>
        <Panel title="Controlled drug balances" description="Running stock for scheduled medicines; reconcile against the physical register weekly.">
          <ul className="space-y-2 text-sm">
            {controlledStock.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <span><span className="text-white">{row.name}</span> <span className="text-slate-500">· {row.outlet}</span></span>
                <span className="tabular-nums text-white">{row.stock} units</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Registers">
        <TabBar
          tabs={[
            {
              key: "trail",
              label: "Audit trail",
              count: events.length,
              content: (
                <DataTable
                  rows={events}
                  columns={eventColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.actorName} ${row.action} ${row.summary}`}
                  filters={[
                    { key: "severity", label: "Severities", options: [{ value: "info", label: "Info" }, { value: "warning", label: "Warning" }, { value: "critical", label: "Critical" }], get: (row) => row.severity },
                    { key: "module", label: "Modules", options: MODULES.map((value) => ({ value, label: value })), get: (row) => row.action.split(".")[0] },
                  ]}
                  exportName="audit-trail"
                  pageSize={15}
                  dense
                />
              ),
            },
            { key: "expired", label: "Expired stock", count: expired.length, content: <DataTable rows={expired} columns={batchColumns} rowKey={(row) => row.id} exportName="expired-stock" dense /> },
            { key: "near", label: "Near expiry", count: nearExpiry.length, content: <DataTable rows={nearExpiry} columns={batchColumns} rowKey={(row) => row.id} exportName="near-expiry" dense /> },
            { key: "controlled", label: "Controlled drug register", count: controlledRegister.length, content: <DataTable rows={controlledRegister} columns={controlledColumns} rowKey={(row) => row.id} search={(row) => `${row.document} ${row.patient} ${row.prescription}`} exportName="controlled-register" dense /> },
          ]}
        />
      </Panel>
    </div>
  );
}
