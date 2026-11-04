"use client";

import { Barcode, Boxes, FileWarning, Pencil, PlusCircle, ShieldAlert, TrendingUp } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import { compactMoney, money } from "@/lib/format";

type Item = {
  id: string;
  name: string;
  genericName: string;
  category: string;
  manufacturer: string;
  strength: string;
  uom: string;
  purchasePrice: number;
  sellingPrice: number;
  minStock: number;
  stock: number;
  sellable: number;
  status: string;
  barcode: string;
  nafdacNumber: string;
  outletId: string;
  rxOnly: boolean;
  controlled: boolean;
  locations: number;
};
type Permissions = { manage: boolean; restrict: boolean; network: boolean };

const margin = (item: Pick<Item, "purchasePrice" | "sellingPrice">) =>
  item.sellingPrice ? Math.round(((item.sellingPrice - item.purchasePrice) / item.sellingPrice) * 1000) / 10 : 0;

function Flags({ item }: { item: Pick<Item, "rxOnly" | "controlled"> }) {
  return (
    <span className="ml-2 inline-flex gap-1 align-middle">
      {item.rxOnly ? <span className="rounded bg-sky-500/15 px-1 text-[10px] font-semibold text-sky-300">Rx</span> : null}
      {item.controlled ? <span className="rounded bg-rose-500/15 px-1 text-[10px] font-semibold text-rose-300">CD</span> : null}
    </span>
  );
}

export function ItemsWorkspace({
  items,
  categories,
  locations,
  scope,
  permissions,
}: {
  items: Item[];
  categories: string[];
  locations: { id: string; name: string }[];
  scope?: string;
  permissions: Permissions;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const loc = (id: string) => locations.find((row) => row.id === id)?.name.replace(/^Outlet \d - /, "") ?? id;
  const distinct = new Set(items.map((item) => item.name)).size;
  const pending = items.filter((item) => item.nafdacNumber === "Pending");
  const avgMargin = items.length ? items.reduce((sum, item) => sum + margin(item), 0) / items.length : 0;

  const columns: Column<Item>[] = [
    {
      key: "name",
      header: "Item",
      value: (row) => row.name,
      render: (row) => (
        <div>
          <p className="text-white">{row.name}<Flags item={row} /></p>
          <p className="text-[11px] text-slate-500">{row.genericName} · {row.strength} · {row.manufacturer}</p>
        </div>
      ),
    },
    { key: "category", header: "Category", value: (row) => row.category, render: (row) => row.category },
    { key: "loc", header: "Location", value: (row) => loc(row.outletId), render: (row) => loc(row.outletId) },
    { key: "nafdac", header: "NAFDAC", value: (row) => row.nafdacNumber, render: (row) => <span className={`font-mono text-xs ${row.nafdacNumber === "Pending" ? "text-amber-300" : ""}`}>{row.nafdacNumber}</span> },
    { key: "cost", header: "Cost", value: (row) => row.purchasePrice, align: "right", render: (row) => money(row.purchasePrice) },
    { key: "price", header: "Price", value: (row) => row.sellingPrice, align: "right", render: (row) => <span className="font-medium text-white">{money(row.sellingPrice)}</span> },
    { key: "margin", header: "Margin", value: margin, align: "right", render: (row) => <span className={margin(row) < 20 ? "text-amber-300" : "text-emerald-300"}>{margin(row)}%</span> },
    {
      key: "stock",
      header: "Stock",
      value: (row) => row.stock,
      align: "right",
      render: (row) => (
        <div>
          <p className="text-white">{row.stock.toLocaleString()} <span className="text-[11px] text-slate-500">{row.uom}</span></p>
          {row.sellable < row.stock ? <p className="text-[11px] text-rose-300">{row.stock - row.sellable} quarantined</p> : <p className="text-[11px] text-slate-500">reorder at {row.minStock}</p>}
        </div>
      ),
    },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "edit",
      header: "",
      render: (row) =>
        permissions.manage ? (
          <button type="button" onClick={() => setEditing(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`Edit ${row.name}`}>
            <Pencil className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Item master"
        description="Medicines and consumables with pricing, margin, NAFDAC registration and prescription / controlled-drug flags. Stock enters only through goods receipts."
        scope={scope}
        actions={
          permissions.manage ? (
            <ActionButton onClick={() => setCreating(true)}>
              <PlusCircle className="h-4 w-4" /> New item
            </ActionButton>
          ) : null
        }
      />

      <StatGrid
        stats={[
          { label: "Items", value: String(distinct), note: `${items.length} item-location records`, icon: Boxes, tone: "emerald" },
          { label: "Stock at cost", value: compactMoney(items.reduce((sum, item) => sum + item.stock * item.purchasePrice, 0)), note: `Retail ${compactMoney(items.reduce((sum, item) => sum + item.stock * item.sellingPrice, 0))}`, icon: TrendingUp, tone: "sky" },
          { label: "Average margin", value: `${avgMargin.toFixed(1)}%`, note: `${items.filter((item) => margin(item) < 20).length} item(s) under 20%`, icon: Barcode, tone: "amber" },
          { label: "Regulatory gaps", value: String(pending.length), note: `NAFDAC pending · ${items.filter((item) => item.status === "RESTRICTED").length} restricted`, icon: pending.length ? FileWarning : ShieldAlert, tone: "rose" },
        ]}
      />

      <Panel title="Items">
        <DataTable
          rows={items}
          columns={columns}
          rowKey={(row) => row.id}
          search={(row) => `${row.name} ${row.genericName} ${row.manufacturer} ${row.barcode} ${row.nafdacNumber}`}
          filters={[
            { key: "category", label: "Categories", options: categories.map((value) => ({ value, label: value })), get: (row) => row.category },
            ...(locations.length > 1 ? [{ key: "loc", label: "Locations", options: locations.map((row) => ({ value: row.id, label: row.name })), get: (row: Item) => row.outletId }] : []),
            { key: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "LOW_STOCK", label: "Low stock" }, { value: "RESTRICTED", label: "Restricted" }], get: (row) => row.status },
            { key: "class", label: "Classes", options: [{ value: "otc", label: "OTC" }, { value: "rx", label: "Prescription-only" }, { value: "cd", label: "Controlled" }], get: (row) => (row.controlled ? "cd" : row.rxOnly ? "rx" : "otc") },
          ]}
          exportName="item-master"
          pageSize={12}
        />
      </Panel>

      {creating ? <NewItemModal categories={categories} locations={locations} onClose={() => setCreating(false)} /> : null}
      {editing ? <EditItemModal key={editing.id} item={editing} permissions={permissions} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function NewItemModal({ categories, locations, onClose }: { categories: string[]; locations: { id: string; name: string }[]; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({
    name: "",
    genericName: "",
    category: categories[0],
    manufacturer: "",
    strength: "",
    uom: "Pack",
    purchasePrice: "",
    sellingPrice: "",
    minStock: "50",
    barcode: "",
    nafdacNumber: "",
    outletId: locations[0]?.id ?? "",
    rxOnly: false,
    controlled: false,
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const cost = Number(form.purchasePrice) || 0;
  const price = Number(form.sellingPrice) || 0;

  return (
    <Modal open title="New item" description="Creates the item at one location with zero stock. Receive stock through a PO or Goods Receipt." onClose={onClose} wide>
      <div className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Brand / item name" className="md:col-span-2"><TextInput value={form.name} onChange={set("name")} placeholder="e.g. Amlodipine 5mg" /></Field>
          <Field label="Generic name"><TextInput value={form.genericName} onChange={set("genericName")} placeholder="Amlodipine besylate" /></Field>
          <Field label="Category"><SelectInput value={form.category} onChange={set("category")} options={categories.map((value) => ({ value, label: value }))} /></Field>
          <Field label="Strength"><TextInput value={form.strength} onChange={set("strength")} placeholder="5mg" /></Field>
          <Field label="Unit of measure"><TextInput value={form.uom} onChange={set("uom")} /></Field>
          <Field label="Manufacturer"><TextInput value={form.manufacturer} onChange={set("manufacturer")} /></Field>
          <Field label="NAFDAC reg. no." hint="Format A4-12345, or leave blank if pending"><TextInput value={form.nafdacNumber} onChange={set("nafdacNumber")} placeholder="A4-12345" /></Field>
          <Field label="Barcode" hint="Leave blank to generate one"><TextInput value={form.barcode} onChange={set("barcode")} /></Field>
          <Field label="Cost price (₦)"><TextInput type="number" min={0} value={form.purchasePrice} onChange={set("purchasePrice")} /></Field>
          <Field label="Selling price (₦)" hint={cost && price ? `Margin ${margin({ purchasePrice: cost, sellingPrice: price })}%` : undefined}><TextInput type="number" min={0} value={form.sellingPrice} onChange={set("sellingPrice")} /></Field>
          <Field label="Reorder level"><TextInput type="number" min={0} value={form.minStock} onChange={set("minStock")} /></Field>
          <Field label="Location" className="md:col-span-2"><SelectInput value={form.outletId} disabled={locations.length < 2} onChange={set("outletId")} options={locations.map((row) => ({ value: row.id, label: row.name }))} /></Field>
        </div>
        <ClassToggles rxOnly={form.rxOnly} controlled={form.controlled} onChange={(next) => setForm((current) => ({ ...current, ...next }))} />
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy || form.name.trim().length < 2 || !cost || !price}
            onClick={async () => {
              const ok = await run("/api/products", "POST", {
                ...form,
                purchasePrice: cost,
                sellingPrice: price,
                minStock: Math.floor(Number(form.minStock) || 0),
              });
              if (ok) onClose();
            }}
          >
            Create item
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function ClassToggles({ rxOnly, controlled, onChange }: { rxOnly: boolean; controlled: boolean; onChange: (next: { rxOnly: boolean; controlled: boolean }) => void }) {
  return (
    <div className="flex flex-wrap gap-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" className="h-4 w-4 accent-green-700" checked={rxOnly} onChange={(event) => onChange({ rxOnly: event.target.checked, controlled: event.target.checked ? controlled : false })} />
        Prescription-only (POM)
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="h-4 w-4 accent-green-700" checked={controlled} onChange={(event) => onChange({ rxOnly: event.target.checked ? true : rxOnly, controlled: event.target.checked })} />
        Controlled drug (register every movement)
      </label>
    </div>
  );
}

function EditItemModal({ item, permissions, onClose }: { item: Item; permissions: Permissions; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({
    purchasePrice: String(item.purchasePrice),
    sellingPrice: String(item.sellingPrice),
    minStock: String(item.minStock),
    nafdacNumber: item.nafdacNumber === "Pending" ? "" : item.nafdacNumber,
    rxOnly: item.rxOnly,
    controlled: item.controlled,
    restricted: item.status === "RESTRICTED",
    allLocations: permissions.network && item.locations > 1,
  });
  const cost = Number(form.purchasePrice) || 0;
  const price = Number(form.sellingPrice) || 0;

  return (
    <Modal open title={`Edit ${item.name}`} description={`${item.genericName} · ${item.strength} · barcode ${item.barcode}`} onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost price (₦)"><TextInput type="number" min={0} value={form.purchasePrice} onChange={(event) => setForm((current) => ({ ...current, purchasePrice: event.target.value }))} /></Field>
          <Field label="Selling price (₦)" hint={`Margin ${margin({ purchasePrice: cost, sellingPrice: price })}%`}><TextInput type="number" min={0} value={form.sellingPrice} onChange={(event) => setForm((current) => ({ ...current, sellingPrice: event.target.value }))} /></Field>
          <Field label="Reorder level (this location)"><TextInput type="number" min={0} value={form.minStock} onChange={(event) => setForm((current) => ({ ...current, minStock: event.target.value }))} /></Field>
          <Field label="NAFDAC reg. no."><TextInput value={form.nafdacNumber} placeholder="Pending" onChange={(event) => setForm((current) => ({ ...current, nafdacNumber: event.target.value }))} /></Field>
        </div>
        <ClassToggles rxOnly={form.rxOnly} controlled={form.controlled} onChange={(next) => setForm((current) => ({ ...current, ...next }))} />
        {permissions.restrict ? (
          <label className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-rose-600" checked={form.restricted} onChange={(event) => setForm((current) => ({ ...current, restricted: event.target.checked }))} />
            <span>Restrict item (e.g. NAFDAC recall). Restricted items cannot be sold or received.</span>
          </label>
        ) : null}
        {permissions.network && item.locations > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-green-700" checked={form.allLocations} onChange={(event) => setForm((current) => ({ ...current, allLocations: event.target.checked }))} />
            Apply price and regulatory changes at all {item.locations} locations
          </label>
        ) : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy || !cost || !price}
            onClick={async () => {
              const ok = await run(`/api/products/${item.id}`, "PATCH", {
                purchasePrice: cost,
                sellingPrice: price,
                minStock: Math.floor(Number(form.minStock) || 0),
                nafdacNumber: form.nafdacNumber,
                rxOnly: form.rxOnly,
                controlled: form.controlled,
                restricted: permissions.restrict ? form.restricted : undefined,
                allLocations: form.allLocations,
              });
              if (ok) onClose();
            }}
          >
            Save changes
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
