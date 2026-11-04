"use client";

import { Pencil, PlusCircle } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { Panel } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import { shortDate } from "@/lib/format";

type OutletRow = {
  id: string;
  name: string;
  code: string;
  type: "RETAIL" | "WAREHOUSE";
  address: string;
  manager: string;
  phone: string;
  pcnLicense: string;
  licenceExpiry: string;
  status: "ACTIVE" | "CLOSED";
  staff: number;
  units: number;
};

const empty: Omit<OutletRow, "id" | "staff" | "units"> = { name: "", code: "", type: "RETAIL", address: "", manager: "", phone: "", pcnLicense: "", licenceExpiry: "", status: "ACTIVE" };

/** Super Administrator outlet register: create, edit and close outlets. */
export function OutletManager({ outlets }: { outlets: OutletRow[] }) {
  const [editing, setEditing] = useState<OutletRow | "new" | null>(null);
  const columns: Column<OutletRow>[] = [
    { key: "name", header: "Outlet", value: (row) => row.name, render: (row) => <div><p className="text-white">{row.name}</p><p className="text-[11px] text-slate-500">{row.address}</p></div> },
    { key: "code", header: "Code", value: (row) => row.code, render: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { key: "type", header: "Type", value: (row) => row.type, render: (row) => (row.type === "WAREHOUSE" ? "Warehouse" : "Retail") },
    { key: "manager", header: "Manager", value: (row) => row.manager, render: (row) => <div><p>{row.manager}</p><p className="text-[11px] text-slate-500">{row.phone}</p></div> },
    { key: "licence", header: "PCN licence", value: (row) => row.licenceExpiry, render: (row) => <div><p className="font-mono text-xs">{row.pcnLicense}</p><p className="text-[11px] text-slate-500">{row.licenceExpiry ? `exp ${shortDate(row.licenceExpiry)}` : ""}</p></div> },
    { key: "staff", header: "Staff", value: (row) => row.staff, align: "right", render: (row) => row.staff },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status === "ACTIVE" ? "Active" : "Closed"} tone={row.status === "ACTIVE" ? "emerald" : "slate"} /> },
    { key: "edit", header: "", render: (row) => <button type="button" aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><Pencil className="h-4 w-4" /></button> },
  ];
  return (
    <Panel title="Outlet register" description="Super Administrator only. Closing an outlet requires zero stock and no pending movements; its staff lose access to it." actions={<ActionButton onClick={() => setEditing("new")}><PlusCircle className="h-4 w-4" /> New outlet</ActionButton>}>
      <DataTable rows={outlets} columns={columns} rowKey={(row) => row.id} exportName="outlets" dense />
      {editing ? <OutletModal outlet={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Panel>
  );
}

function OutletModal({ outlet, onClose }: { outlet: OutletRow | null; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState(() => (outlet ? { ...outlet } : { ...empty }));
  const set = (key: keyof typeof empty) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const payload = { name: form.name, code: form.code, type: form.type, address: form.address, manager: form.manager, phone: form.phone, pcnLicense: form.pcnLicense, licenceExpiry: form.licenceExpiry };
  return (
    <Modal open title={outlet ? `Edit ${outlet.name}` : "New outlet"} description={outlet ? `${outlet.staff} staff · ${outlet.units.toLocaleString()} units on hand` : "Assign staff to it from Staff & users after creating it."} onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name"><TextInput value={form.name} onChange={set("name")} placeholder="Outlet 4 - Surulere" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code"><TextInput value={form.code} onChange={set("code")} placeholder="OUT-04" /></Field>
          <Field label="Type"><SelectInput value={form.type} onChange={set("type")} options={[{ value: "RETAIL", label: "Retail" }, { value: "WAREHOUSE", label: "Warehouse" }]} /></Field>
        </div>
        <Field label="Address" className="md:col-span-2"><TextInput value={form.address} onChange={set("address")} /></Field>
        <Field label="Manager name"><TextInput value={form.manager} onChange={set("manager")} /></Field>
        <Field label="Phone"><TextInput value={form.phone} onChange={set("phone")} /></Field>
        <Field label="PCN premises licence"><TextInput value={form.pcnLicense} onChange={set("pcnLicense")} placeholder="PCN/PR/LA/2026/0000" /></Field>
        <Field label="Licence expiry"><TextInput type="date" value={form.licenceExpiry} onChange={set("licenceExpiry")} /></Field>
        {outlet ? <Field label="Status"><SelectInput value={form.status} onChange={set("status")} options={[{ value: "ACTIVE", label: "Active" }, { value: "CLOSED", label: "Closed" }]} /></Field> : null}
        <div className="md:col-span-2"><FormError message={error} /></div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy} onClick={async () => (await (outlet ? run(`/api/outlets/${outlet.id}`, "PATCH", { ...payload, status: form.status }) : run("/api/outlets", "POST", payload))) && onClose()}>
            {outlet ? "Save outlet" : "Create outlet"}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
