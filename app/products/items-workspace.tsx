"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Barcode, Boxes, CalendarClock, FileWarning, ListChecks, Pencil, PlusCircle, ScanLine, ShieldAlert, TrendingUp } from "lucide-react";
import { useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";
import type { ProductCatalogLists } from "@/lib/erp/types";
import { compactMoney, money, shortDate } from "@/lib/format";

type Item = {
  id: string;
  name: string;
  sku: string;
  genericName: string;
  category: string;
  dosageForm: string;
  manufacturer: string;
  strength: string;
  uom: string;
  purchasePrice: number;
  sellingPrice: number;
  minStock: number;
  stock: number;
  breakdown: string;
  sellable: number;
  value: number;
  status: string;
  lifecycle: string;
  barcode: string;
  batchNumbers: string[];
  expiredQty: number;
  nearQty: number;
  quarantinedQty: number;
  nextExpiry: string;
  expiryState: string;
  nafdacNumber: string;
  outletId: string;
  rxOnly: boolean;
  controlled: boolean;
  locations: number;
};
type Permissions = { manage: boolean; price: boolean; restrict: boolean; network: boolean; catalog: boolean };

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
  catalog,
  nearExpiryDays,
  locations,
  scope,
  activeOutletId,
  initialQuery = "",
  permissions,
}: {
  initialQuery?: string;
  items: Item[];
  catalog: ProductCatalogLists;
  nearExpiryDays: number;
  locations: { id: string; name: string }[];
  scope?: string;
  activeOutletId: string | null;
  permissions: Permissions;
}) {
  const [editing, setEditing] = useState<Item | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const loc = (id: string) => locations.find((row) => row.id === id)?.name.replace(/^Outlet \d - /, "") ?? id;
  const distinct = new Set(items.map((item) => item.name)).size;
  const pending = items.filter((item) => item.nafdacNumber === "Pending");
  const low = items.filter((item) => item.status === "LOW_STOCK" && item.lifecycle === "ACTIVE");
  const expiredValueItems = items.filter((item) => item.expiredQty > 0);
  const nearItems = items.filter((item) => item.nearQty > 0);

  const columns: Column<Item>[] = [
    {
      key: "name",
      header: "Item",
      value: (row) => row.name,
      render: (row) => (
        <div>
          <Link href={`/products/${row.id}`} className="text-white hover:text-emerald-300 hover:underline">{row.name}</Link>
          <Flags item={row} />
          <p className="text-[11px] text-slate-500">{[row.genericName, row.strength, row.dosageForm, row.manufacturer].filter((part) => part && part !== "-").join(" · ")}</p>
        </div>
      ),
    },
    { key: "category", header: "Category", value: (row) => row.category, render: (row) => row.category },
    { key: "loc", header: "Location", value: (row) => loc(row.outletId), render: (row) => loc(row.outletId) },
    {
      key: "stock",
      header: "Stock",
      value: (row) => row.stock,
      align: "right",
      render: (row) => (
        <div>
          <p className={row.status === "LOW_STOCK" ? "text-amber-300" : "text-white"}>{row.stock.toLocaleString()} <span className="text-[11px] text-slate-500">{row.uom}</span></p>
          {row.breakdown ? <p className="text-[11px] text-slate-500">{row.breakdown}</p> : null}
          {row.sellable < row.stock ? <p className="text-[11px] text-rose-300">{row.stock - row.sellable} blocked</p> : <p className="text-[11px] text-slate-500">reorder at {row.minStock}</p>}
        </div>
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      value: (row) => row.nextExpiry || "9999",
      render: (row) => (
        <div className="text-xs">
          {row.nextExpiry ? <p className={row.expiryState === "near" ? "text-amber-300" : "text-slate-300"}>Next {shortDate(row.nextExpiry)}</p> : <p className="text-slate-500">—</p>}
          {row.expiredQty ? <p className="text-rose-300">{row.expiredQty} expired</p> : null}
          {row.nearQty ? <p className="text-amber-300">{row.nearQty} near expiry</p> : null}
          {row.quarantinedQty ? <p className="text-rose-300">{row.quarantinedQty} quarantined</p> : null}
        </div>
      ),
    },
    { key: "price", header: "Price", value: (row) => row.sellingPrice, align: "right", render: (row) => <div><p className="font-medium text-white">{money(row.sellingPrice)}</p><p className={`text-[11px] ${margin(row) < 20 ? "text-amber-300" : "text-slate-500"}`}>{margin(row)}% margin</p></div> },
    { key: "value", header: "Value (cost)", value: (row) => row.value, align: "right", render: (row) => money(row.value) },
    {
      key: "status",
      header: "Status",
      value: (row) => row.status,
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          {row.lifecycle !== "ACTIVE" ? <StatusBadge status={row.lifecycle} /> : null}
          <StatusBadge status={row.status} />
        </div>
      ),
    },
    {
      key: "edit",
      header: "",
      render: (row) =>
        permissions.manage ? (
          <button type="button" onClick={() => setEditing(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`Quick edit ${row.name}`}>
            <Pencil className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory & item master"
        description="Every item, batch and balance per outlet. Stock levels come from the stock ledger and change only through receipts, sales, transfers and approved adjustments."
        scope={scope}
        actions={
          <>
            {permissions.catalog ? (
              <ActionButton tone="secondary" onClick={() => setCatalogOpen(true)}>
                <ListChecks className="h-4 w-4" /> Catalogue lists
              </ActionButton>
            ) : null}
            {permissions.manage ? (
              <Link href="/products/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-[#fff] hover:bg-blue-700">
                <PlusCircle className="h-4 w-4" /> Register product
              </Link>
            ) : null}
          </>
        }
      />

      <StatGrid
        stats={[
          { label: "Items", value: String(distinct), note: `${items.length} item-location records`, icon: Boxes, tone: "emerald" },
          { label: "Inventory value (cost)", value: compactMoney(items.reduce((sum, item) => sum + item.value, 0)), note: `Retail ${compactMoney(items.reduce((sum, item) => sum + item.stock * item.sellingPrice, 0))}`, icon: TrendingUp, tone: "sky" },
          { label: "Low stock", value: String(low.length), note: `${nearItems.length} item(s) with stock expiring within ${nearExpiryDays} days`, icon: low.length ? AlertTriangle : CalendarClock, tone: "amber" },
          { label: "Expired / regulatory", value: String(expiredValueItems.length), note: `items holding expired stock · ${pending.length} NAFDAC pending`, icon: pending.length ? FileWarning : ShieldAlert, tone: "rose" },
        ]}
      />

      <Panel title="Items" description="Search by name, generic name, barcode, batch or NAFDAC number." actions={<BarcodeJump outletId={activeOutletId} />}>
        <DataTable
          rows={items}
          columns={columns}
          rowKey={(row) => row.id}
          search={(row) => `${row.name} ${row.sku} ${row.genericName} ${row.manufacturer} ${row.barcode} ${row.nafdacNumber} ${row.batchNumbers.join(" ")}`}
          filters={[
            { key: "category", label: "Categories", options: catalog.categories.map((value) => ({ value, label: value })), get: (row) => row.category },
            ...(locations.length > 1 ? [{ key: "loc", label: "Locations", options: locations.map((row) => ({ value: row.id, label: row.name })), get: (row: Item) => row.outletId }] : []),
            { key: "stock", label: "Stock levels", options: [{ value: "ACTIVE", label: "In stock" }, { value: "LOW_STOCK", label: "Low stock" }, { value: "RESTRICTED", label: "Restricted" }], get: (row) => row.status },
            { key: "expiry", label: "Expiry", options: [{ value: "expired", label: "Has expired stock" }, { value: "near", label: `Expiring ≤ ${nearExpiryDays} days` }, { value: "ok", label: "No expiry issues" }, { value: "none", label: "No stock" }], get: (row) => [row.expiryState, ...(row.nearQty ? ["near"] : [])] },
            { key: "batch", label: "Batches", options: Array.from(new Set(items.flatMap((row) => row.batchNumbers))).sort().map((value) => ({ value, label: value })), get: (row) => row.batchNumbers },
            { key: "lifecycle", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "DISCONTINUED", label: "Discontinued" }], get: (row) => row.lifecycle },
            { key: "class", label: "Classes", options: [{ value: "otc", label: "OTC" }, { value: "rx", label: "Prescription-only" }, { value: "cd", label: "Controlled" }], get: (row) => (row.controlled ? "cd" : row.rxOnly ? "rx" : "otc") },
          ]}
          exportName="inventory"
          initialQuery={initialQuery}
          pageSize={12}
        />
      </Panel>

      {catalogOpen ? <CatalogModal catalog={catalog} onClose={() => setCatalogOpen(false)} /> : null}
      {editing ? <EditItemModal key={editing.id} item={editing} permissions={permissions} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/** Scan a barcode to open the item it belongs to. */
function BarcodeJump({ outletId }: { outletId: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function go() {
    setMessage(null);
    const response = await fetch(`/api/barcodes?code=${encodeURIComponent(code.trim())}${outletId ? `&outletId=${outletId}` : ""}`);
    const data = (await response.json().catch(() => ({}))) as { error?: string } | { productId: string }[];
    if (!response.ok || !Array.isArray(data)) return setMessage((data as { error?: string }).error ?? "Not found.");
    if (Array.isArray(data) && data.length) router.push(`/products/${data[0].productId}`);
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim()) void go();
      }}
    >
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
        <TextInput value={code} onChange={(event) => setCode(event.target.value)} placeholder="Scan barcode…" aria-label="Scan barcode" className="w-48 pl-8" />
      </div>
      <ActionButton type="submit" tone="secondary" disabled={!code.trim()}><Barcode className="h-4 w-4" /> Find</ActionButton>
      {message ? <span className="text-xs text-rose-300">{message}</span> : null}
    </form>
  );
}

const CATALOG_LISTS: { key: keyof ProductCatalogLists; label: string; hint: string }[] = [
  { key: "categories", label: "Categories", hint: "Therapeutic or merchandising groups." },
  { key: "dosageForms", label: "Dosage forms", hint: "Tablet, syrup, injection…" },
  { key: "productTypes", label: "Product types", hint: "POM, OTC, supplement…" },
  { key: "packagingTypes", label: "Packaging types", hint: "Suggested names for packaging levels." },
];

function CatalogModal({ catalog, onClose }: { catalog: ProductCatalogLists; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [lists, setLists] = useState(() => Object.fromEntries(CATALOG_LISTS.map(({ key }) => [key, catalog[key].join("\n")])) as Record<keyof ProductCatalogLists, string>);
  return (
    <Modal open title="Catalogue lists" description="One entry per line. Entries used by registered items cannot be removed." onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-2">
        {CATALOG_LISTS.map(({ key, label, hint }) => (
          <Field key={key} label={label} hint={hint}>
            <textarea
              value={lists[key]}
              onChange={(event) => setLists((current) => ({ ...current, [key]: event.target.value }))}
              rows={8}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/60"
            />
          </Field>
        ))}
      </div>
      <div className="mt-3 grid gap-3">
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy}
            onClick={async () => {
              const body = Object.fromEntries(CATALOG_LISTS.map(({ key }) => [key, lists[key].split("\n").map((value) => value.trim()).filter(Boolean)]));
              if (await run("/api/catalog", "PATCH", body)) onClose();
            }}
          >
            Save lists
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
    <Modal open title={`Quick edit ${item.name}`} description={`Base-unit prices, reorder level and flags. Packaging prices, barcodes and status are on the product page.`} onClose={onClose}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost price (₦)" hint={permissions.price ? undefined : "Price changes need a manager"}><TextInput type="number" min={0} disabled={!permissions.price} value={form.purchasePrice} onChange={(event) => setForm((current) => ({ ...current, purchasePrice: event.target.value }))} /></Field>
          <Field label="Selling price (₦)" hint={`Margin ${margin({ purchasePrice: cost, sellingPrice: price })}%`}><TextInput type="number" min={0} disabled={!permissions.price} value={form.sellingPrice} onChange={(event) => setForm((current) => ({ ...current, sellingPrice: event.target.value }))} /></Field>
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
                purchasePrice: permissions.price ? cost : undefined,
                sellingPrice: permissions.price ? price : undefined,
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
