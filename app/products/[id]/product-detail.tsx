"use client";

import Link from "next/link";
import { ArrowLeft, Barcode, Boxes, CalendarClock, History, Pencil, Plus, Printer, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import { BarcodeSvg } from "@/components/erp/barcode-svg";
import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput, inputClass } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { Panel } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { TabBar } from "@/components/erp/tabs";
import { useAction } from "@/components/erp/use-action";
import { describeBreakdown, describeConversion } from "@/lib/erp/packaging";
import { isNativeApp } from "@/lib/native";
import type { productDetail } from "@/lib/erp/products";
import type { ProductCatalogLists, StockLedgerEntry, StockLedgerType } from "@/lib/erp/types";
import { dateTime, money, shortDate } from "@/lib/format";

type Detail = ReturnType<typeof productDetail>;
type BatchRow = Detail["batches"][number];
type PriceRow = Detail["prices"][number];
type Permissions = { manage: boolean; price: boolean; quarantine: boolean; destroy: boolean; stockView: boolean; regulatory: boolean };

const FORMAT_LABELS: Record<string, string> = { EAN13: "EAN-13", UPCA: "UPC-A", CODE128: "Code 128" };

export function ProductDetail({
  detail,
  catalog,
  suppliers,
  outletLabels,
  ledgerLabels,
  permissions,
}: {
  detail: Detail;
  catalog: ProductCatalogLists;
  suppliers: { id: string; name: string }[];
  outletLabels: Record<string, string>;
  ledgerLabels: Record<StockLedgerType, string>;
  permissions: Permissions;
}) {
  const { product, summary, prices } = detail;
  const [editing, setEditing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [addingBarcode, setAddingBarcode] = useState(false);
  const [batchAction, setBatchAction] = useState<{ batch: BatchRow; action: "quarantine" | "release" | "destroy" } | null>(null);
  const { run, error } = useAction();
  const unit = product.baseUnit;
  const levels = product.packaging;
  const qty = (value: number) => `${value.toLocaleString()} ${unit}`;
  const pack = (value: number) => (levels.length > 1 && value > 0 ? describeBreakdown(value, levels) : "");

  const cards: { label: string; value: number; tone?: string }[] = [
    { label: "Opening", value: summary.opening },
    { label: "Received", value: summary.received },
    { label: "Sold", value: -summary.sold },
    { label: "Issued", value: -summary.issued },
    { label: "Transferred in", value: summary.transferredIn },
    { label: "Transferred out", value: -summary.transferredOut },
    { label: "Customer returns", value: summary.returned },
    { label: "Returned to supplier", value: -summary.supplierReturns },
    { label: "Adjustments (net)", value: summary.adjustments },
    { label: "Written off", value: -summary.writtenOff },
  ];

  const batchColumns: Column<BatchRow>[] = [
    { key: "batch", header: "Batch", value: (row) => row.batchNumber, render: (row) => <div><p className="font-mono text-xs text-white">{row.batchNumber}</p>{row.supplierBatchRef ? <p className="text-[11px] text-slate-500">Supplier ref {row.supplierBatchRef}</p> : null}</div> },
    { key: "supplier", header: "Supplier", value: (row) => row.supplier, render: (row) => <div><p>{row.supplier}</p>{row.regulatoryNumber ? <p className="text-[11px] text-slate-500">NAFDAC {row.regulatoryNumber}</p> : null}</div> },
    { key: "dates", header: "Mfg / received", value: (row) => row.receivingDate, render: (row) => <span className="text-xs text-slate-400">{row.manufacturingDate ? shortDate(row.manufacturingDate) : "—"} / {shortDate(row.receivingDate)}</span> },
    { key: "expiry", header: "Expiry", value: (row) => row.expiryDate, render: (row) => <span className={row.days < 0 ? "text-rose-300" : row.days <= detail.nearExpiryDays ? "text-amber-300" : ""}>{shortDate(row.expiryDate)} <span className="text-[11px] text-slate-500">({row.days < 0 ? `${-row.days}d ago` : `${row.days}d`})</span></span> },
    { key: "qty", header: "On hand", align: "right", value: (row) => row.availableQuantity, render: (row) => <div><p className="text-white">{row.availableQuantity.toLocaleString()} <span className="text-[11px] text-slate-500">of {row.quantityReceived.toLocaleString()}</span></p>{pack(row.availableQuantity) ? <p className="text-[11px] text-slate-500">{pack(row.availableQuantity)}</p> : null}</div> },
    { key: "cost", header: "Cost / unit", align: "right", value: (row) => row.purchasePrice, render: (row) => money(row.purchasePrice) },
    { key: "value", header: "Value", align: "right", value: (row) => row.value, render: (row) => money(row.value) },
    { key: "state", header: "State", value: (row) => row.state, render: (row) => <StatusBadge status={row.state} /> },
    {
      key: "act",
      header: "",
      render: (row) => {
        if (row.availableQuantity <= 0 || row.pendingMovement) return row.pendingMovement ? <span className="text-[11px] text-amber-300">Awaiting approval</span> : null;
        if (row.state === "Expired") return permissions.destroy ? <ActionButton tone="danger" className="h-7 text-xs" onClick={() => setBatchAction({ batch: row, action: "destroy" })}>Destroy</ActionButton> : null;
        if (!permissions.quarantine) return null;
        if (row.state === "Quarantined" && row.disposition?.status === "QUARANTINED") return <ActionButton tone="secondary" className="h-7 text-xs" onClick={() => setBatchAction({ batch: row, action: "release" })}>Release</ActionButton>;
        if (!row.disposition) return <ActionButton tone="secondary" className="h-7 text-xs" onClick={() => setBatchAction({ batch: row, action: "quarantine" })}>Quarantine</ActionButton>;
        return null;
      },
    },
  ];

  const ledgerColumns: Column<StockLedgerEntry>[] = [
    { key: "at", header: "Date", value: (row) => row.at, render: (row) => <span className="whitespace-nowrap text-xs">{dateTime(row.at)}</span> },
    { key: "ref", header: "Reference", value: (row) => row.reference, render: (row) => <span className="font-mono text-xs text-white">{row.reference}</span> },
    { key: "type", header: "Type", value: (row) => row.type, render: (row) => ledgerLabels[row.type] ?? row.type },
    { key: "batch", header: "Batch", value: (row) => row.batchNumber, render: (row) => <span className="font-mono text-xs">{row.batchNumber}</span> },
    { key: "qty", header: "Quantity", align: "right", value: (row) => row.baseQuantity, render: (row) => <div><p className={row.baseQuantity < 0 ? "text-rose-300" : "text-emerald-300"}>{row.baseQuantity > 0 ? "+" : ""}{row.baseQuantity.toLocaleString()}</p>{row.unitsPerUnit > 1 ? <p className="text-[11px] text-slate-500">{row.quantity} {row.unit}</p> : null}</div> },
    { key: "bal", header: "Balance", align: "right", value: (row) => row.newBalance, render: (row) => <span className="tabular-nums text-xs text-slate-400">{row.previousBalance.toLocaleString()} → <span className="text-white">{row.newBalance.toLocaleString()}</span></span> },
    { key: "user", header: "By", value: (row) => row.userName, render: (row) => <span className="text-xs">{row.userName}</span> },
    { key: "remarks", header: "Remarks", render: (row) => <span className="text-xs text-slate-400">{row.remarks}</span> },
  ];

  const priceColumns: Column<PriceRow>[] = [
    { key: "name", header: "Package", value: (row) => row.name, render: (row) => <span className="text-white">{row.name}{!row.sellable ? <span className="ml-2 text-[11px] text-slate-500">not sold</span> : null}</span> },
    { key: "units", header: unit, align: "right", value: (row) => row.unitsPerPackage, render: (row) => row.unitsPerPackage.toLocaleString() },
    { key: "buy", header: "Purchase", align: "right", value: (row) => row.purchasePrice ?? 0, render: (row) => (row.purchasePrice !== undefined ? money(row.purchasePrice) : "—") },
    { key: "sell", header: "Selling", align: "right", value: (row) => row.sellingPrice ?? 0, render: (row) => <span className="text-white">{row.sellingPrice !== undefined ? money(row.sellingPrice) : "—"}{row.custom ? <span className="ml-1 text-[10px] text-sky-300">set</span> : null}</span> },
    { key: "wholesale", header: "Wholesale", align: "right", value: (row) => row.wholesalePrice ?? 0, render: (row) => (row.wholesalePrice !== undefined ? money(row.wholesalePrice) : "—") },
    { key: "min", header: "Minimum", align: "right", value: (row) => row.minSellingPrice ?? 0, render: (row) => (row.minSellingPrice !== undefined ? money(row.minSellingPrice) : "—") },
    { key: "margin", header: "Margin", align: "right", value: (row) => (row.sellingPrice && row.purchasePrice ? (row.sellingPrice - row.purchasePrice) / row.sellingPrice : 0), render: (row) => (row.sellingPrice && row.purchasePrice ? `${Math.round(((row.sellingPrice - row.purchasePrice) / row.sellingPrice) * 1000) / 10}%` : "—") },
  ];

  const registration = detail.registration;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/products" className="mt-1 rounded-lg border border-slate-800 p-2 text-slate-300 hover:bg-slate-800" aria-label="Back to inventory"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">{product.category}{product.dosageForm ? ` · ${product.dosageForm}` : ""}</p>
            <h3 className="mt-1 text-2xl font-bold text-white">{product.name}</h3>
            <p className="text-sm text-slate-400">{[product.genericName, product.strength, product.size, product.manufacturer].filter((part) => part && part !== "-").join(" · ")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={product.lifecycle ?? "ACTIVE"} />
              <StatusBadge status={product.status} />
              {product.rxOnly ? <StatusBadge status="Prescription-only" tone="sky" /> : null}
              {product.controlled ? <StatusBadge status="Controlled drug" tone="rose" /> : null}
              <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">{product.outletName}</span>
            </div>
          </div>
        </div>
        {permissions.manage ? (
          <div className="flex flex-wrap gap-2">
            {permissions.price ? <ActionButton tone="secondary" onClick={() => setPricing(true)}><Pencil className="h-4 w-4" /> Prices</ActionButton> : null}
            <ActionButton tone="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Details & status</ActionButton>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Big label="Available stock" value={qty(summary.available)} note={pack(summary.available) || `${summary.usable.toLocaleString()} usable`} />
        <Big label="Usable (in date, not quarantined)" value={qty(summary.usable)} note={summary.usable < summary.available ? `${(summary.available - summary.usable).toLocaleString()} blocked` : `Reorder at ${product.minStock.toLocaleString()}`} />
        <Big label="Stock value (cost)" value={money(summary.value)} note={`Retail ≈ ${money(summary.available * product.sellingPrice)}`} />
        <Big label="Packaging" value={levels.map((level) => level.name).join(" › ")} note={describeConversion(levels) || `Sold per ${unit}`} />
      </div>

      <TabBar
        tabs={[
          {
            key: "overview",
            label: "Stock calculation",
            content: (
              <Panel title="Stock calculation" description={`All figures in ${unit}s, calculated from the stock ledger. Balances cannot be edited directly.`}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {cards.map((card) => (
                    <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{card.label}</p>
                      <p className={`mt-1 text-lg font-semibold tabular-nums ${card.value < 0 ? "text-rose-300" : card.value > 0 ? "text-emerald-300" : "text-slate-300"}`}>{card.value > 0 ? "+" : ""}{card.value.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
                  <p className="text-sm text-slate-300">Available = sum of all ledger entries</p>
                  <p className="text-lg font-semibold text-white">{qty(summary.available)}{pack(summary.available) ? <span className="ml-2 text-sm font-normal text-slate-400">({pack(summary.available)})</span> : null}</p>
                </div>
                {detail.otherOutlets.length ? (
                  <div className="mt-4 text-sm">
                    <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-slate-400">Same item at other outlets</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.otherOutlets.map((row) => (
                        <Link key={row.id} href={`/products/${row.id}`} className="rounded-lg border border-slate-800 px-3 py-1.5 hover:bg-slate-800">{row.outletName}: <span className="text-white">{row.stock.toLocaleString()}</span></Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Panel>
            ),
          },
          {
            key: "batches",
            label: "Batches & expiry",
            count: detail.batches.filter((row) => row.availableQuantity > 0).length,
            content: (
              <Panel title="Batches" description="First-expiry-first-out: the earliest usable expiry is sold first. Expired and quarantined batches are blocked from sale and issue.">
                <DataTable rows={detail.batches} columns={batchColumns} rowKey={(row) => row.id} search={(row) => `${row.batchNumber} ${row.supplier} ${row.supplierBatchRef ?? ""}`} filters={[{ key: "state", label: "States", options: ["Healthy", "Near expiry", "Expired", "Quarantined", "Depleted"].map((value) => ({ value, label: value })), get: (row) => row.state }]} exportName={`batches-${product.name}`} />
                <FormError message={error} />
              </Panel>
            ),
          },
          {
            key: "pricing",
            label: "Packaging & prices",
            content: (
              <div className="space-y-4">
                <Panel title="Prices by packaging level" description={`Base prices are per ${unit}; package prices are calculated unless set.`} actions={permissions.price ? <ActionButton tone="secondary" onClick={() => setPricing(true)}><Pencil className="h-4 w-4" /> Edit prices</ActionButton> : null}>
                  <DataTable rows={prices} columns={priceColumns} rowKey={(row) => row.id} />
                </Panel>
                <Panel title="Price history" description="Old sales and receipts keep the prices they were made at.">
                  <DataTable
                    rows={detail.priceHistory}
                    rowKey={(row) => row.id}
                    columns={[
                      { key: "at", header: "Date", value: (row) => row.at, render: (row) => <span className="text-xs">{dateTime(row.at)}</span> },
                      { key: "level", header: "Level", value: (row) => row.level, render: (row) => row.level },
                      { key: "kind", header: "Price", value: (row) => row.kind, render: (row) => row.kind },
                      { key: "old", header: "Old", align: "right", value: (row) => row.oldValue ?? 0, render: (row) => (row.oldValue === null ? "—" : money(row.oldValue)) },
                      { key: "new", header: "New", align: "right", value: (row) => row.newValue ?? 0, render: (row) => <span className="text-white">{row.newValue === null ? "—" : money(row.newValue)}</span> },
                      { key: "by", header: "By", value: (row) => row.userName, render: (row) => row.userName },
                    ]}
                    emptyMessage="No price changes recorded yet."
                  />
                </Panel>
              </div>
            ),
          },
          {
            key: "barcodes",
            label: "Barcodes",
            count: product.barcodes.length,
            content: (
              <Panel title="Barcodes" description="Scan any of these at POS or goods receipt. Each barcode belongs to one packaging level." actions={permissions.manage ? <ActionButton tone="secondary" onClick={() => setAddingBarcode(true)}><Plus className="h-4 w-4" /> Add barcode</ActionButton> : null}>
                {product.barcodes.length === 0 ? <p className="text-sm text-slate-400">No barcode yet. Items without a barcode are found by name at POS.</p> : null}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {product.barcodes.map((barcode) => (
                    <div key={barcode.code} className="rounded-xl border border-slate-800 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono text-sm text-white">{barcode.code}</p>
                          <p className="text-[11px] text-slate-400">{FORMAT_LABELS[barcode.format] ?? barcode.format} · {levels.find((level) => level.id === barcode.packagingId)?.name ?? unit} · {barcode.source === "INTERNAL" ? "internal" : "manufacturer"}</p>
                        </div>
                        {permissions.manage ? (
                          <button type="button" className="rounded p-1 text-slate-500 hover:text-rose-300" aria-label={`Remove ${barcode.code}`} onClick={() => confirm(`Remove barcode ${barcode.code}?`) && void run(`/api/products/${product.id}/barcodes?code=${encodeURIComponent(barcode.code)}`, "DELETE")}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <BarcodeSvg code={barcode.code} />
                        <button type="button" onClick={() => printLabel(product.name, barcode.code, money(prices.find((row) => row.id === barcode.packagingId)?.sellingPrice ?? product.sellingPrice))} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Print label"><Printer className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <FormError message={error} />
              </Panel>
            ),
          },
          ...(permissions.stockView
            ? [
                {
                  key: "ledger",
                  label: "Stock ledger",
                  count: detail.ledger.length,
                  content: (
                    <Panel title="Stock ledger" description="Every receipt, sale, return, transfer, adjustment and write-off for this item at this outlet.">
                      <DataTable rows={detail.ledger} columns={ledgerColumns} rowKey={(row) => row.id} search={(row) => `${row.reference} ${row.batchNumber} ${row.userName} ${row.remarks ?? ""}`} filters={[{ key: "type", label: "Types", options: Object.entries(ledgerLabels).map(([value, label]) => ({ value, label })), get: (row) => row.type }]} exportName={`ledger-${product.name}`} pageSize={15} />
                    </Panel>
                  ),
                },
              ]
            : []),
          {
            key: "regulatory",
            label: "Regulatory",
            content: (
              <Panel title="Regulatory information" description="Maintained by regulatory staff on the Regulatory page." actions={<Link href="/regulatory" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm text-slate-100 hover:bg-slate-800"><ShieldCheck className="h-4 w-4" /> {permissions.regulatory ? "Update register / upload documents" : "Open register"}</Link>}>
                <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <Item label="NAFDAC registration no." value={registration?.nafdacNumber ?? product.nafdacNumber} />
                  <Item label="Regulatory status" value={registration?.status ?? (product.nafdacNumber === "Pending" ? "Pending" : "Registered")} />
                  <Item label="Local representative" value={registration?.localRepresentative} />
                  <Item label="Approval date" value={registration?.issuedDate ? shortDate(registration.issuedDate) : undefined} />
                  <Item label="Renewal date" value={registration?.renewalDate ? shortDate(registration.renewalDate) : undefined} />
                  <Item label="Registration expiry" value={registration?.expiryDate ? shortDate(registration.expiryDate) : undefined} />
                </dl>
                <p className="mb-2 mt-5 text-[11px] uppercase tracking-[0.14em] text-slate-400">Supporting documents</p>
                {detail.documents.length ? (
                  <ul className="space-y-1 text-sm">
                    {detail.documents.map((document) => (
                      <li key={document.id}><a className="text-emerald-300 hover:underline" href={`/api/regulatory/documents/${document.id}`}>{document.title}</a> <span className="text-xs text-slate-500">· {document.category}{document.expiresOn ? ` · expires ${shortDate(document.expiresOn)}` : ""}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-400">No documents linked to {product.name} yet.</p>
                )}
              </Panel>
            ),
          },
        ]}
      />

      <p className="text-xs text-slate-500">
        <Boxes className="mr-1 inline h-3.5 w-3.5" />Stock enters through goods receipts (<Link className="underline" href="/inventory">Batches & GRN</Link>) and moves through <Link className="underline" href="/stock">Stock movements</Link>.{" "}
        <History className="mx-1 inline h-3.5 w-3.5" />Preferred supplier: {product.supplierName ?? "none"}.{" "}
        <Barcode className="mx-1 inline h-3.5 w-3.5" />Outlet: {outletLabels[product.outletId] ?? product.outletId}. <CalendarClock className="mx-1 inline h-3.5 w-3.5" />Near-expiry window {detail.nearExpiryDays} days.
      </p>

      {editing ? <EditDetailsModal detail={detail} catalog={catalog} suppliers={suppliers} onClose={() => setEditing(false)} /> : null}
      {pricing ? <EditPricesModal detail={detail} onClose={() => setPricing(false)} /> : null}
      {addingBarcode ? <AddBarcodeModal detail={detail} onClose={() => setAddingBarcode(false)} /> : null}
      {batchAction ? <BatchActionModal {...batchAction} unit={unit} onClose={() => setBatchAction(null)} /> : null}
    </div>
  );
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function printLabel(name: string, code: string, price: string) {
  if (isNativeApp()) return alert("Label printing needs a computer with a label printer. Open this product on the web to print.");
  const svg = document.querySelector(`svg[aria-label="Barcode ${code}"]`)?.outerHTML ?? `<p>${escapeHtml(code)}</p>`;
  const win = window.open("", "_blank", "width=420,height=320");
  if (!win) return;
  win.document.write(`<html><head><title>${escapeHtml(code)}</title></head><body style="font-family:sans-serif;text-align:center;margin:16px">` + `<div style="font-size:13px;font-weight:600">${escapeHtml(name)}</div>${svg.replace('class="h-16 w-auto bg-white"', 'style="height:90px"')}<div style="font-size:15px;font-weight:700">${escapeHtml(price)}</div></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function Big({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-slate-400">{note}</p> : null}
    </div>
  );
}

function Item({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className="text-white">{value || "—"}</dd>
    </div>
  );
}

function EditDetailsModal({ detail, catalog, suppliers, onClose }: { detail: Detail; catalog: ProductCatalogLists; suppliers: { id: string; name: string }[]; onClose: () => void }) {
  const { product } = detail;
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({
    genericName: product.genericName,
    category: product.category,
    productType: product.productType ?? "",
    dosageForm: product.dosageForm ?? "",
    strength: product.strength === "-" ? "" : product.strength,
    size: product.size ?? "",
    manufacturer: product.manufacturer === "-" ? "" : product.manufacturer,
    supplierId: product.supplierId ?? "",
    description: product.description ?? "",
    lifecycle: product.lifecycle ?? "ACTIVE",
  });
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const withCurrent = (list: string[], value: string) => (value && !list.includes(value) ? [value, ...list] : list);
  return (
    <Modal open title={`Edit ${product.name}`} description="Master data and status for this outlet's item record." onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Generic name"><TextInput value={form.genericName} onChange={set("genericName")} /></Field>
        <Field label="Category"><SelectInput value={form.category} onChange={set("category")} options={withCurrent(catalog.categories, form.category).map((value) => ({ value, label: value }))} /></Field>
        <Field label="Product type"><SelectInput value={form.productType} onChange={set("productType")} options={[{ value: "", label: "—" }, ...catalog.productTypes.map((value) => ({ value, label: value }))]} /></Field>
        <Field label="Dosage form"><SelectInput value={form.dosageForm} onChange={set("dosageForm")} options={[{ value: "", label: "—" }, ...catalog.dosageForms.map((value) => ({ value, label: value }))]} /></Field>
        <Field label="Strength"><TextInput value={form.strength} onChange={set("strength")} /></Field>
        <Field label="Size / weight"><TextInput value={form.size} onChange={set("size")} /></Field>
        <Field label="Manufacturer"><TextInput value={form.manufacturer} onChange={set("manufacturer")} /></Field>
        <Field label="Preferred supplier"><SelectInput value={form.supplierId} onChange={set("supplierId")} options={[{ value: "", label: "None" }, ...suppliers.map((row) => ({ value: row.id, label: row.name }))]} /></Field>
        <Field label="Status" hint="Inactive: not sold. Discontinued: not sold or received."><SelectInput value={form.lifecycle} onChange={set("lifecycle")} options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "DISCONTINUED", label: "Discontinued" }]} /></Field>
        <Field label="Description" className="md:col-span-3"><textarea value={form.description} onChange={set("description")} rows={3} className={`${inputClass} h-auto py-2`} /></Field>
      </div>
      <div className="mt-3 grid gap-3">
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy} onClick={async () => (await run(`/api/products/${product.id}`, "PATCH", form)) && onClose()}>Save</ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function EditPricesModal({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const { product } = detail;
  const { run, error, busy } = useAction();
  const fields = ["purchasePrice", "sellingPrice", "wholesalePrice", "minSellingPrice"] as const;
  const [base, setBase] = useState(() => Object.fromEntries(fields.map((field) => [field, product[field] ? String(product[field]) : ""])) as Record<(typeof fields)[number], string>);
  const [levels, setLevels] = useState(() =>
    Object.fromEntries(product.packaging.filter((level) => !level.isBase).map((level) => [level.id, { ...Object.fromEntries(fields.map((field) => [field, level[field] ? String(level[field]) : ""])), sellable: level.sellable }])) as Record<string, Record<(typeof fields)[number], string> & { sellable: boolean }>,
  );
  const [baseSellable, setBaseSellable] = useState(product.packaging.find((level) => level.isBase)?.sellable ?? true);
  const value = (text: string) => (text.trim() === "" ? null : Number(text));
  const labels = { purchasePrice: "Purchase", sellingPrice: "Selling", wholesalePrice: "Wholesale", minSellingPrice: "Minimum" };
  const baseLevel = product.packaging.find((level) => level.isBase);
  return (
    <Modal open title={`Prices · ${product.name}`} description="Leave a package price blank to calculate it from the base price. Every change is kept in the price history." onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-4">
        {fields.map((field) => (
          <Field key={field} label={`${labels[field]} / ${product.baseUnit} (₦)`}>
            <TextInput type="number" min={0} step="0.01" value={base[field]} onChange={(event) => setBase((current) => ({ ...current, [field]: event.target.value }))} />
          </Field>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-green-700" checked={baseSellable} onChange={(event) => setBaseSellable(event.target.checked)} /> Sell by the {product.baseUnit.toLowerCase()}</label>
      {product.packaging.length > 1 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-slate-400"><tr><th className="py-2">Package</th>{fields.map((field) => <th key={field} className="py-2">{labels[field]} (₦)</th>)}<th className="py-2">Sold</th></tr></thead>
            <tbody>
              {product.packaging.filter((level) => !level.isBase).map((level) => (
                <tr key={level.id} className="border-t border-slate-800">
                  <td className="py-2 text-white">{level.name} <span className="text-[11px] text-slate-500">({level.unitsPerPackage} {product.baseUnit})</span></td>
                  {fields.map((field) => (
                    <td key={field} className="py-2 pr-2">
                      <input type="number" min={0} step="0.01" value={levels[level.id][field]} placeholder={base[field] ? String(Math.round(Number(base[field]) * level.unitsPerPackage * 100) / 100) : ""} onChange={(event) => setLevels((current) => ({ ...current, [level.id]: { ...current[level.id], [field]: event.target.value } }))} className="h-8 w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 text-right text-white placeholder:text-slate-600" aria-label={`${level.name} ${labels[field]}`} />
                    </td>
                  ))}
                  <td className="py-2"><input type="checkbox" className="h-4 w-4 accent-green-700" checked={levels[level.id].sellable} onChange={(event) => setLevels((current) => ({ ...current, [level.id]: { ...current[level.id], sellable: event.target.checked } }))} aria-label={`Sell by ${level.name}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3">
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            disabled={busy}
            onClick={async () => {
              const levelPrices = Object.fromEntries(Object.entries(levels).map(([id, row]) => [id, { ...Object.fromEntries(fields.map((field) => [field, value(row[field])])), sellable: row.sellable }]));
              if (baseLevel) levelPrices[baseLevel.id] = { sellable: baseSellable };
              const ok = await run(`/api/products/${product.id}`, "PATCH", { pricing: Object.fromEntries(fields.map((field) => [field, value(base[field])])), levelPrices });
              if (ok) onClose();
            }}
          >
            Save prices
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function AddBarcodeModal({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const { product } = detail;
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({ source: "MANUFACTURER", code: "", format: "", packagingId: product.packaging.find((level) => level.isBase)?.id ?? "" });
  return (
    <Modal open title="Add barcode" description="Scan the manufacturer barcode, or generate an internal EAN-13 for a packaging level." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Barcode type"><SelectInput value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} options={[{ value: "MANUFACTURER", label: "Existing manufacturer barcode" }, { value: "INTERNAL", label: "Generate internal barcode" }]} /></Field>
        <Field label="Packaging level"><SelectInput value={form.packagingId} onChange={(event) => setForm((current) => ({ ...current, packagingId: event.target.value }))} options={product.packaging.map((level) => ({ value: level.id, label: `${level.name} (${level.unitsPerPackage} ${product.baseUnit})` }))} /></Field>
        {form.source === "MANUFACTURER" ? (
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="Barcode"><TextInput autoFocus value={form.code} onKeyDown={(event) => event.key === "Enter" && event.preventDefault()} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} placeholder="Scan or type" /></Field>
            <Field label="Format"><SelectInput value={form.format} onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))} options={[{ value: "", label: "Auto-detect" }, ...Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label }))]} /></Field>
          </div>
        ) : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy || (form.source === "MANUFACTURER" && !form.code.trim())} onClick={async () => (await run(`/api/products/${product.id}/barcodes`, "POST", { source: form.source, code: form.code || undefined, format: form.format || undefined, packagingId: form.packagingId || undefined })) && onClose()}>
            {form.source === "INTERNAL" ? "Generate" : "Add barcode"}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function BatchActionModal({ batch, action, unit, onClose }: { batch: BatchRow; action: "quarantine" | "release" | "destroy"; unit: string; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [note, setNote] = useState("");
  const titles = { quarantine: "Quarantine batch", release: "Release batch", destroy: "Request destruction" };
  const help = {
    quarantine: "Blocks the batch from sale, issue and transfer until released (e.g. suspected recall or damage).",
    release: "Returns the batch to saleable stock. Record why it is safe.",
    destroy: "Raises a write-off for approval by another user on the Stock page.",
  };
  return (
    <Modal open title={`${titles[action]} ${batch.batchNumber}`} description={`${batch.availableQuantity.toLocaleString()} ${unit} · expires ${shortDate(batch.expiryDate)}`} onClose={onClose}>
      <div className="grid gap-3">
        <p className="text-sm text-slate-300">{help[action]}</p>
        <Field label={action === "destroy" ? "Note (optional)" : "Reason"}><TextInput value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone={action === "release" ? "primary" : "danger"} disabled={busy || (action !== "destroy" && note.trim().length < 3)} onClick={async () => (await run(`/api/batches/${batch.id}`, "PATCH", { action, note })) && onClose()}>
            {titles[action]}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
