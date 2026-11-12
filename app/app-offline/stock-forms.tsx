"use client";

import { useCallback, useEffect, useState } from "react";

import type { DeviceRecord } from "@/lib/offline/db";
import { offlineDatabase } from "@/lib/offline/db";
import { adjustOffline, createOfflineProduct, offlineRecords, receiveOffline, type OfflineRecord } from "@/lib/offline/stock";

type Option = { id: string; name: string };
type ProductOption = Option & { packaging: { name: string; unitsPerPackage: number }[]; pending: boolean };
type BatchOption = { id: string; productId: string; batchNumber: string; expiryDate: string; availableQuantity: number };

const input = "h-9 w-full rounded-lg border border-slate-300 px-2 text-sm";
const STATUS: Record<string, string> = { pending: "Waiting to upload", uploading: "Uploading", failed: "Retrying", synced: "Uploaded", conflict: "Needs reconciliation", attention: "Needs attention" };

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-slate-700">{text}</span>
      {children}
    </label>
  );
}

export function StockForms({ record, onSaved }: { record: DeviceRecord; onSaved: () => void }) {
  const can = (permission: string) => record.permissions.includes(permission);
  const forms = [can("purchase.receive") && "receive", can("stock.request") && "adjust", can("products.manage") && "product"].filter(Boolean) as ("receive" | "adjust" | "product")[];
  const [form, setForm] = useState(forms[0] ?? "receive");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [records, setRecords] = useState<OfflineRecord[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const load = useCallback(async () => {
    const db = offlineDatabase(record.tenantId, record.userId);
    const all = await db.products.orderBy("name").toArray();
    setProducts(all.map((product) => ({ id: product.id, name: `${String(product.name)}${product.pendingSync ? " (new, not uploaded yet)" : ""}`, packaging: product.packaging as ProductOption["packaging"], pending: Boolean(product.pendingSync) })));
    setSuppliers((await db.suppliers.orderBy("name").toArray()).map((supplier) => ({ id: supplier.id, name: supplier.name })));
    setBatches((await db.batches.toArray()) as unknown as BatchOption[]);
    setCategories((((await db.lists.get("catalog"))?.value ?? { categories: [] }) as { categories: string[] }).categories);
    setRecords(await offlineRecords(record));
  }, [record]);

  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = () => void load();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function save() {
    setMessage(null);
    try {
      let done: { localNumber: string };
      if (form === "product") {
        done = await createOfflineProduct(record, {
          name: values.name ?? "",
          genericName: values.genericName,
          category: values.category ?? "",
          strength: values.strength,
          manufacturer: values.manufacturer,
          baseUnit: values.baseUnit ?? "",
          packName: values.packName,
          packSize: Number(values.packSize) || undefined,
          purchasePrice: Number(values.purchasePrice),
          sellingPrice: Number(values.sellingPrice),
          barcode: values.barcode,
          minStock: Number(values.minStock) || undefined,
        });
      } else if (form === "receive") {
        done = await receiveOffline(record, {
          productId: values.productId ?? "",
          supplierId: values.supplierId ?? "",
          packagingName: values.packagingName ?? "",
          quantity: Number(values.quantity),
          unitCost: Number(values.unitCost),
          batchNumber: values.batchNumber ?? "",
          manufacturingDate: values.manufacturingDate ?? "",
          expiryDate: values.expiryDate ?? "",
          invoiceNumber: values.invoiceNumber,
          note: values.note,
        });
      } else {
        done = await adjustOffline(record, { productId: values.productId ?? "", batchId: values.batchId || undefined, direction: (values.direction as "IN" | "OUT") ?? "OUT", quantity: Number(values.quantity), reason: values.reason ?? "" });
      }
      setMessage({ ok: true, text: `Saved as ${done.localNumber}. It uploads automatically when the connection is back.` });
      setValues({});
      await load();
      onSaved();
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    }
  }

  const product = products.find((row) => row.id === values.productId);
  if (!forms.length) return <p className="m-4 rounded-2xl bg-white p-4 text-sm text-slate-600">Your account cannot record stock work.</p>;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1fr] print:hidden">
      <section className="space-y-3 rounded-2xl bg-white p-4">
        <div className="flex flex-wrap gap-1">
          {forms.map((name) => (
            <button key={name} type="button" onClick={() => { setForm(name); setMessage(null); }} className={`rounded-full px-3 py-1.5 text-sm ${form === name ? "bg-[#188030] text-white" : "border border-slate-300"}`}>
              {name === "receive" ? "Receive stock" : name === "adjust" ? "Adjust stock" : "New product"}
            </button>
          ))}
        </div>
        {form === "product" ? (
          <div className="grid gap-3 sm:grid-cols-2" data-form="product">
            <Label text="Product name"><input className={input} value={values.name ?? ""} onChange={(event) => set("name", event.target.value)} /></Label>
            <Label text="Generic name"><input className={input} value={values.genericName ?? ""} onChange={(event) => set("genericName", event.target.value)} /></Label>
            <Label text="Category">
              <select className={input} value={values.category ?? ""} onChange={(event) => set("category", event.target.value)}>
                <option value="">Choose…</option>
                {categories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </Label>
            <Label text="Strength"><input className={input} value={values.strength ?? ""} onChange={(event) => set("strength", event.target.value)} /></Label>
            <Label text="Base unit (e.g. Tablet)"><input className={input} value={values.baseUnit ?? ""} onChange={(event) => set("baseUnit", event.target.value)} /></Label>
            <Label text="Brand / manufacturer"><input className={input} value={values.manufacturer ?? ""} onChange={(event) => set("manufacturer", event.target.value)} /></Label>
            <Label text="Pack name (optional)"><input className={input} value={values.packName ?? ""} onChange={(event) => set("packName", event.target.value)} placeholder="Pack" /></Label>
            <Label text="Base units per pack"><input className={input} inputMode="numeric" value={values.packSize ?? ""} onChange={(event) => set("packSize", event.target.value)} /></Label>
            <Label text="Purchase price per base unit (₦)"><input className={input} inputMode="decimal" value={values.purchasePrice ?? ""} onChange={(event) => set("purchasePrice", event.target.value)} /></Label>
            <Label text="Selling price per base unit (₦)"><input className={input} inputMode="decimal" value={values.sellingPrice ?? ""} onChange={(event) => set("sellingPrice", event.target.value)} /></Label>
            <Label text="Barcode"><input className={input} value={values.barcode ?? ""} onChange={(event) => set("barcode", event.target.value)} /></Label>
            <Label text="Reorder level (base units)"><input className={input} inputMode="numeric" value={values.minStock ?? ""} onChange={(event) => set("minStock", event.target.value)} /></Label>
            <p className="text-xs text-slate-500 sm:col-span-2">A new product can have stock received against it now, and becomes sellable once it has been created in PharmaERP.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2" data-form={form}>
            <Label text="Product">
              <select className={input} value={values.productId ?? ""} onChange={(event) => setValues({ productId: event.target.value })} data-field="product">
                <option value="">Choose…</option>
                {products.filter((row) => form === "receive" || !row.pending).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Label>
            {form === "receive" ? (
              <>
                <Label text="Supplier">
                  <select className={input} value={values.supplierId ?? ""} onChange={(event) => set("supplierId", event.target.value)} data-field="supplier">
                    <option value="">Choose…</option>
                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </Label>
                <Label text="Counted in">
                  <select className={input} value={values.packagingName ?? ""} onChange={(event) => set("packagingName", event.target.value)} data-field="packaging">
                    <option value="">Choose…</option>
                    {product?.packaging.map((level) => <option key={level.name}>{level.name}</option>)}
                  </select>
                </Label>
                <Label text="Quantity"><input className={input} inputMode="numeric" value={values.quantity ?? ""} onChange={(event) => set("quantity", event.target.value)} data-field="quantity" /></Label>
                <Label text="Cost per package (₦)"><input className={input} inputMode="decimal" value={values.unitCost ?? ""} onChange={(event) => set("unitCost", event.target.value)} data-field="cost" /></Label>
                <Label text="Batch number"><input className={input} value={values.batchNumber ?? ""} onChange={(event) => set("batchNumber", event.target.value)} data-field="batch" /></Label>
                <Label text="Manufacturing date"><input type="date" className={input} value={values.manufacturingDate ?? ""} onChange={(event) => set("manufacturingDate", event.target.value)} data-field="mfg" /></Label>
                <Label text="Expiry date"><input type="date" className={input} value={values.expiryDate ?? ""} onChange={(event) => set("expiryDate", event.target.value)} data-field="expiry" /></Label>
                <Label text="Supplier invoice no."><input className={input} value={values.invoiceNumber ?? ""} onChange={(event) => set("invoiceNumber", event.target.value)} /></Label>
                <Label text="Note"><input className={input} value={values.note ?? ""} onChange={(event) => set("note", event.target.value)} /></Label>
              </>
            ) : (
              <>
                <Label text="Direction">
                  <select className={input} value={values.direction ?? "OUT"} onChange={(event) => set("direction", event.target.value)}>
                    <option value="OUT">Remove (damaged, missing, count short)</option>
                    <option value="IN">Add (count surplus)</option>
                  </select>
                </Label>
                <Label text="Batch">
                  <select className={input} value={values.batchId ?? ""} onChange={(event) => set("batchId", event.target.value)}>
                    <option value="">{values.direction === "IN" ? "Choose…" : "Any (first expiry first)"}</option>
                    {batches.filter((batch) => batch.productId === values.productId).map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNumber} · exp {batch.expiryDate} · {batch.availableQuantity}</option>)}
                  </select>
                </Label>
                <Label text="Quantity (base units)"><input className={input} inputMode="numeric" value={values.quantity ?? ""} onChange={(event) => set("quantity", event.target.value)} /></Label>
                <Label text="Reason"><input className={input} value={values.reason ?? ""} onChange={(event) => set("reason", event.target.value)} /></Label>
                <p className="text-xs text-slate-500 sm:col-span-2">Adjustments are sent for approval when uploaded, as they are online.</p>
              </>
            )}
          </div>
        )}
        {message ? <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{message.text}</p> : null}
        <button type="button" onClick={() => void save()} className="w-full rounded-full bg-[#188030] py-2 font-semibold text-white" data-save-stock>
          Save
        </button>
      </section>
      <section className="rounded-2xl bg-white p-4">
        <h2 className="mb-2 font-semibold">Stock records on this device</h2>
        <ul className="divide-y divide-slate-100 text-sm" data-stock-records>
          {records.map((row) => (
            <li key={row.id} className="py-2" data-record-status={row.status} data-record-kind={row.kind}>
              <p className="font-medium">{row.localNumber} · {row.kind === "product" ? "New product" : row.kind === "receiving" ? "Receipt" : "Adjustment"}</p>
              <p className="text-xs text-slate-600">{row.summary}</p>
              <p className="text-xs text-slate-500">{STATUS[row.status] ?? row.status}{row.message ? ` · ${row.message}` : ""}</p>
            </li>
          ))}
          {!records.length ? <li className="py-4 text-center text-slate-500">Nothing recorded offline.</li> : null}
        </ul>
      </section>
    </div>
  );
}
