"use client";

import { Building, CircleDollarSign, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { TabBar } from "@/components/erp/tabs";
import { useAction } from "@/components/erp/use-action";
import type { Customer, CustomerType, Supplier } from "@/lib/erp/types";
import { compactMoney, money } from "@/lib/format";

const CUSTOMER_TYPES: CustomerType[] = ["Retail", "Corporate", "HMO", "Clinic", "Walk-in"];

export function ContactsWorkspace({
  customers,
  suppliers,
  outlets,
  scope,
  canManage,
  canAddSupplier,
  canVerify,
}: {
  customers: Customer[];
  /** Null when the viewer works with customers only (sales roles). */
  suppliers: Supplier[] | null;
  canAddSupplier: boolean;
  outlets: { id: string; name: string }[];
  scope?: string;
  canManage: boolean;
  canVerify: boolean;
}) {
  const [adding, setAdding] = useState<"customer" | "supplier" | null>(null);
  const { run, error } = useAction();
  const receivable = customers.reduce((sum, row) => sum + row.balance, 0);
  const payable = (suppliers ?? []).reduce((sum, row) => sum + row.balance, 0);
  const overLimit = customers.filter((row) => row.creditLimit > 0 && row.balance / row.creditLimit >= 0.8);

  const customerColumns: Column<Customer>[] = [
    { key: "code", header: "Code", value: (row) => row.code, render: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { key: "name", header: "Customer", value: (row) => row.name, render: (row) => <div><p className="text-white">{row.name}</p><p className="text-[11px] text-slate-500">{row.phone} · {row.email}</p></div> },
    { key: "type", header: "Type", value: (row) => row.type, render: (row) => row.type },
    { key: "outlet", header: "Home outlet", value: (row) => row.outletId ?? "", render: (row) => outlets.find((outlet) => outlet.id === row.outletId)?.name.replace(/^Outlet \d - /, "") ?? "All" },
    { key: "limit", header: "Credit limit", value: (row) => row.creditLimit, align: "right", render: (row) => (row.creditLimit ? money(row.creditLimit) : <span className="text-slate-500">Cash only</span>) },
    { key: "balance", header: "Balance due", value: (row) => row.balance, align: "right", render: (row) => <span className={row.balance > 0 ? "text-amber-300" : "text-slate-500"}>{money(row.balance)}</span> },
    {
      key: "util",
      header: "Utilisation",
      value: (row) => (row.creditLimit ? row.balance / row.creditLimit : 0),
      render: (row) => {
        if (!row.creditLimit) return <span className="text-slate-500">—</span>;
        const pct = Math.min(100, Math.round((row.balance / row.creditLimit) * 100));
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800"><div className={`h-full ${pct >= 80 ? "bg-rose-400" : pct >= 50 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} /></div>
            <span className="text-xs text-slate-400">{pct}%</span>
          </div>
        );
      },
    },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
  ];

  const supplierColumns: Column<Supplier>[] = [
    { key: "code", header: "Code", value: (row) => row.code, render: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { key: "name", header: "Supplier", value: (row) => row.name, render: (row) => <div><p className="text-white">{row.name}</p><p className="text-[11px] text-slate-500">{row.contactPerson} · {row.phone}</p></div> },
    { key: "categories", header: "Categories", value: (row) => row.categories, render: (row) => <span className="text-slate-400">{row.categories}</span> },
    { key: "pcn", header: "PCN licence", value: (row) => row.pcnLicense, render: (row) => <span className={`font-mono text-xs ${row.pcnLicense.startsWith("PCN/") ? "" : "text-rose-300"}`}>{row.pcnLicense}</span> },
    { key: "terms", header: "Terms", value: (row) => row.paymentTermsDays, align: "right", render: (row) => `${row.paymentTermsDays} days` },
    { key: "balance", header: "We owe", value: (row) => row.balance, align: "right", render: (row) => <span className={row.balance > 0 ? "text-amber-300" : "text-slate-500"}>{money(row.balance)}</span> },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      render: (row) =>
        canVerify ? (
          <div className="flex justify-end gap-1">
            {row.status !== "Approved" ? <ActionButton tone="secondary" className="h-7 text-xs" onClick={() => void run(`/api/suppliers/${row.id}`, "PATCH", { status: "Approved" })}>Verify</ActionButton> : null}
            {row.status !== "Suspended" ? <ActionButton tone="ghost" className="h-7 text-xs" onClick={() => void run(`/api/suppliers/${row.id}`, "PATCH", { status: "Suspended" })}>Suspend</ActionButton> : null}
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={suppliers ? "Customers & suppliers" : "Customers"}
        description="Credit-controlled customer accounts (retail, HMO, corporate, clinic) and PCN-verified supplier master data."
        scope={scope}
        actions={
          canManage ? (
            <>
              {suppliers && canAddSupplier ? <ActionButton tone="secondary" onClick={() => setAdding("supplier")}><Building className="h-4 w-4" /> Add supplier</ActionButton> : null}
              <ActionButton onClick={() => setAdding("customer")}><UserPlus className="h-4 w-4" /> Add customer</ActionButton>
            </>
          ) : null
        }
      />

      <StatGrid
        stats={[
          { label: "Customer accounts", value: String(customers.length), note: `${customers.filter((row) => row.type === "HMO").length} HMOs · ${customers.filter((row) => row.type === "Corporate" || row.type === "Clinic").length} institutional`, icon: Users, tone: "sky" },
          { label: "Receivables", value: compactMoney(receivable), note: `${overLimit.length} account(s) above 80% of limit`, icon: CircleDollarSign, tone: "amber" },
          ...(suppliers
            ? [
                { label: "Suppliers", value: String(suppliers.length), note: `${suppliers.filter((row) => row.status !== "Approved").length} awaiting verification / suspended`, icon: ShieldCheck, tone: "emerald" as const },
                { label: "Payables", value: compactMoney(payable), note: "Owed to suppliers", icon: Building, tone: "rose" as const },
              ]
            : []),
        ]}
      />

      <FormError message={error} />

      <Panel title="Directory">
        <TabBar
          tabs={[
            {
              key: "customers",
              label: "Customers",
              count: customers.length,
              content: (
                <DataTable
                  rows={customers}
                  columns={customerColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.code} ${row.name} ${row.phone} ${row.email}`}
                  filters={[
                    { key: "type", label: "Types", options: CUSTOMER_TYPES.map((value) => ({ value, label: value })), get: (row) => row.type },
                    { key: "status", label: "Statuses", options: [{ value: "Active", label: "Active" }, { value: "On hold", label: "On hold" }], get: (row) => row.status },
                  ]}
                  exportName="customers"
                />
              ),
            },
            ...(suppliers
              ? [
{
              key: "suppliers",
              label: "Suppliers",
              count: suppliers.length,
              content: (
                <DataTable
                  rows={suppliers}
                  columns={supplierColumns}
                  rowKey={(row) => row.id}
                  search={(row) => `${row.code} ${row.name} ${row.contactPerson} ${row.categories} ${row.pcnLicense}`}
                  filters={[{ key: "status", label: "Statuses", options: ["Approved", "Pending verification", "Suspended"].map((value) => ({ value, label: value })), get: (row) => row.status }]}
                  exportName="suppliers"
                />
              ),
            },
                ]
              : []),
          ]}
        />
      </Panel>

      {adding === "customer" ? <CustomerModal outlets={outlets} onClose={() => setAdding(null)} /> : null}
      {adding === "supplier" ? <SupplierModal onClose={() => setAdding(null)} /> : null}
    </div>
  );
}

function CustomerModal({ outlets, onClose }: { outlets: { id: string; name: string }[]; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({ name: "", type: "Retail" as CustomerType, phone: "", email: "", creditLimit: "0", outletId: "" });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Modal open title="New customer" description="Credit limits apply to Retail, Corporate, HMO and Clinic accounts." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Name"><TextInput value={form.name} onChange={set("name")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><SelectInput value={form.type} onChange={set("type")} options={CUSTOMER_TYPES.map((value) => ({ value, label: value }))} /></Field>
          <Field label="Credit limit (₦)"><TextInput type="number" min={0} value={form.creditLimit} onChange={set("creditLimit")} disabled={form.type === "Walk-in"} /></Field>
          <Field label="Phone"><TextInput value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><TextInput type="email" value={form.email} onChange={set("email")} /></Field>
        </div>
        <Field label="Home outlet"><SelectInput value={form.outletId} onChange={set("outletId")} options={[{ value: "", label: "All outlets" }, ...outlets.map((row) => ({ value: row.id, label: row.name }))]} /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy || form.name.trim().length < 2}
            onClick={async () => {
              const ok = await run("/api/contacts", "POST", { kind: "customer", ...form, creditLimit: Number(form.creditLimit) || 0, outletId: form.outletId || null });
              if (ok) onClose();
            }}
          >
            Create customer
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function SupplierModal({ onClose }: { onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({ name: "", contactPerson: "", phone: "", email: "", pcnLicense: "", paymentTermsDays: "30", categories: "" });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Modal open title="New supplier" description="New suppliers start as “Pending verification” until their PCN licence is checked." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Company name"><TextInput value={form.name} onChange={set("name")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person"><TextInput value={form.contactPerson} onChange={set("contactPerson")} /></Field>
          <Field label="Phone"><TextInput value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><TextInput type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Payment terms (days)"><TextInput type="number" min={0} value={form.paymentTermsDays} onChange={set("paymentTermsDays")} /></Field>
        </div>
        <Field label="PCN wholesale licence" hint="Format PCN/WS/YYYY/NNNN"><TextInput value={form.pcnLicense} onChange={set("pcnLicense")} placeholder="PCN/WS/2026/0000" /></Field>
        <Field label="Product categories"><TextInput value={form.categories} onChange={set("categories")} placeholder="e.g. Antibiotics, Analgesics" /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy || form.name.trim().length < 2}
            onClick={async () => {
              const ok = await run("/api/contacts", "POST", { kind: "supplier", ...form, paymentTermsDays: Number(form.paymentTermsDays) || 0 });
              if (ok) onClose();
            }}
          >
            Create supplier
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
