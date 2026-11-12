"use client";

import { Pencil, ShieldOff } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import type { DeviceView } from "@/lib/erp/offline-devices";
import type { OfflinePolicy } from "@/lib/erp/types";

const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-NG") : "—");

export function DevicesWorkspace({ devices, policy }: { devices: DeviceView[]; policy: OfflinePolicy }) {
  const [draft, setDraft] = useState(policy);
  const [detail, setDetail] = useState<DeviceView | null>(null);
  const [mode, setMode] = useState<"view" | "rename" | "revoke">("view");
  const [text, setText] = useState("");
  const save = useAction();
  const act = useAction();

  const open = (device: DeviceView, next: typeof mode) => {
    setDetail(device);
    setMode(next);
    setText(next === "rename" ? device.name : "");
    act.setError(null);
  };

  const columns: Column<DeviceView>[] = [
    { key: "name", header: "Device", render: (row) => <button type="button" className="text-left font-medium text-white hover:underline" onClick={() => open(row, "view")}>{row.name}<span className="block text-xs font-normal text-slate-500">{row.platform ?? ""}</span></button>, value: (row) => row.name },
    { key: "user", header: "Assigned user", render: (row) => row.userName, value: (row) => row.userName },
    { key: "outlet", header: "Outlet", render: (row) => row.outletName, value: (row) => row.outletName },
    { key: "seen", header: "Last activity", render: (row) => when(row.lastSeenAt), value: (row) => row.lastSeenAt ?? "" },
    { key: "sync", header: "Last data download", render: (row) => when(row.lastPackageAt), value: (row) => row.lastPackageAt ?? "" },
    { key: "pending", header: "Pending uploads", render: (row) => (row.pendingCount ? <span className="text-amber-300">{row.pendingCount}</span> : "0"), value: (row) => row.pendingCount },
    {
      key: "status",
      header: "Status",
      render: (row) => (row.status === "REVOKED" ? <StatusBadge status="Revoked" tone="rose" /> : row.ready ? <StatusBadge status="Offline ready" tone="emerald" /> : <StatusBadge status="Not downloaded" tone="amber" />),
      value: (row) => row.status,
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        row.status === "ACTIVE" ? (
          <div className="flex justify-end gap-2">
            <ActionButton tone="ghost" className="h-7 px-2 text-xs" onClick={() => open(row, "rename")}><Pencil className="h-3.5 w-3.5" /> Rename</ActionButton>
            <ActionButton tone="danger" className="h-7 px-2 text-xs" onClick={() => open(row, "revoke")}><ShieldOff className="h-3.5 w-3.5" /> Revoke</ActionButton>
          </div>
        ) : null,
    },
  ];

  async function submit() {
    if (!detail) return;
    const body = mode === "rename" ? { name: text } : { revoke: true, reason: text };
    if (await act.run(`/api/offline/devices/${detail.id}`, "PATCH", body)) setDetail(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Offline Mode & Devices"
        description="Devices your staff have set up to keep working without internet. Each device belongs to one person and one outlet. Revoke a lost or retired device here."
      />
      <Panel title="Offline policy" description="Applies to every device of this pharmacy.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Offline use">
            <SelectInput value={draft.enabled ? "on" : "off"} onChange={(event) => setDraft({ ...draft, enabled: event.target.value === "on" })} options={[{ value: "on", label: "Allowed" }, { value: "off", label: "Switched off" }]} />
          </Field>
          <Field label="Offline access expires after (hours)" hint="A disconnected device cannot learn that it was revoked until it reconnects, so offline access always runs out. 72 h = 3 days.">
            <TextInput type="number" min={1} max={720} value={draft.sessionHours} onChange={(event) => setDraft({ ...draft, sessionHours: Number(event.target.value) })} />
          </Field>
          <Field label="Offline sales beyond downloaded stock" hint="Used by the offline POS update.">
            <SelectInput
              value={draft.stockPolicy}
              onChange={(event) => setDraft({ ...draft, stockPolicy: event.target.value as OfflinePolicy["stockPolicy"] })}
              options={[{ value: "cached-limit", label: "Block: sell only stock the device knows about" }, { value: "allow-negative", label: "Allow, and reconcile when it syncs" }]}
            />
          </Field>
        </div>
        <FormError message={save.error} />
        <div className="mt-4 flex justify-end">
          <ActionButton disabled={save.busy} onClick={() => save.run("/api/offline/policy", "PATCH", draft)}>Save policy</ActionButton>
        </div>
      </Panel>
      <DataTable rows={devices} columns={columns} rowKey={(row) => row.id} search={(row) => `${row.name} ${row.userName} ${row.outletName}`} exportName="offline-devices" emptyMessage="No devices yet. Staff set up a device from Settings → Install PharmaERP." />
      <p className="text-xs text-slate-500">Devices are registered by the person who uses them, from Settings → Install PharmaERP on that device, because the device creates its own key.</p>

      <Modal open={Boolean(detail)} title={detail ? (mode === "rename" ? `Rename ${detail.name}` : mode === "revoke" ? `Revoke ${detail.name}` : detail.name) : ""} onClose={() => setDetail(null)}>
        {detail ? (
          mode === "view" ? (
            <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-sm">
              {[
                ["Device ID", detail.id],
                ["User", detail.userName],
                ["Outlet", detail.outletName],
                ["Registered", when(detail.registeredAt)],
                ["Last activity", when(detail.lastSeenAt)],
                ["Last data download", when(detail.lastPackageAt)],
                ["Last upload", when(detail.lastSyncAt)],
                ["Offline access until", when(detail.offlineValidUntil)],
                ["Pending / failed", `${detail.pendingCount} / ${detail.failedCount}`],
                ["Local data", Object.entries(detail.localCounts).map(([key, value]) => `${key}: ${value}`).join(" · ") || "—"],
                ["Status", detail.status === "REVOKED" ? `Revoked by ${detail.revokedBy} on ${when(detail.revokedAt)}: ${detail.revokeReason}` : "Active"],
              ].map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="break-all text-slate-100">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="space-y-4">
              {mode === "revoke" ? (
                <p className="text-sm text-slate-300">
                  The device loses offline access the next time it connects; its stored products, stock and PIN are then removed. If it stays offline, it keeps working only until its offline access expires ({when(detail.offlineValidUntil)}).
                  {detail.pendingCount ? ` It last reported ${detail.pendingCount} operation(s) not yet uploaded.` : ""}
                </p>
              ) : null}
              <Field label={mode === "rename" ? "Device name" : "Reason (audit log)"}>
                <TextInput value={text} maxLength={mode === "rename" ? 60 : 300} onChange={(event) => setText(event.target.value)} />
              </Field>
              <FormError message={act.error} />
              <div className="flex justify-end gap-2">
                <ActionButton tone="secondary" onClick={() => setDetail(null)}>Cancel</ActionButton>
                <ActionButton tone={mode === "revoke" ? "danger" : "primary"} disabled={act.busy || text.trim().length < 2} onClick={submit}>{mode === "rename" ? "Save name" : "Revoke device"}</ActionButton>
              </div>
            </div>
          )
        ) : null}
      </Modal>
    </div>
  );
}
