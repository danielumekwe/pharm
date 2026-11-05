"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Barcode,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  Info,
  PackagePlus,
  Plus,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { ActionButton, Field, FormError, SelectInput, TextInput, inputClass } from "@/components/erp/fields";
import { useAction } from "@/components/erp/use-action";
import { money } from "@/lib/format";
import {
  barcodeError,
  buildPackaging,
  describeBreakdown,
  describeConversion,
  detectBarcodeFormat,
  normaliseBarcode,
  type BarcodeFormat,
  type PackagingLevel,
} from "@/lib/erp/packaging";
import type { ProductCatalogLists } from "@/lib/erp/types";

type Option = { id: string; name: string };

type LevelRow = { key: string; name: string; contains: string; sellable: boolean; purchasePrice: string; sellingPrice: string; wholesalePrice: string; minSellingPrice: string };
type BarcodeRow = { key: string; levelKey: string; code: string; format: "" | BarcodeFormat };
type BatchRow = {
  key: string;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  receivingDate: string;
  supplierId: string;
  supplierBatchRef: string;
  regulatoryNumber: string;
  levelKey: string;
  quantity: string;
  unitCost: string;
};

const SECTIONS = [
  { id: "general", title: "General information", icon: Info },
  { id: "barcode", title: "Barcode information", icon: Barcode },
  { id: "packaging", title: "Packaging configuration", icon: Boxes },
  { id: "pricing", title: "Pricing", icon: CircleDollarSign },
  { id: "regulatory", title: "Regulatory information", icon: ShieldCheck },
  { id: "stock", title: "Batch, expiry & opening stock", icon: CalendarClock },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const FORMAT_LABELS: Record<BarcodeFormat, string> = { EAN13: "EAN-13", UPCA: "UPC-A", CODE128: "Code 128" };
const today = () => new Date().toISOString().slice(0, 10);
let counter = 0;
const key = () => `k${++counter}`;
const num = (value: string) => (value.trim() === "" ? undefined : Number(value));
const priceOrNull = (value: string) => {
  const parsed = num(value);
  return parsed !== undefined && parsed > 0 ? parsed : null;
};

function newLevel(name: string, contains = ""): LevelRow {
  return { key: key(), name, contains, sellable: true, purchasePrice: "", sellingPrice: "", wholesalePrice: "", minSellingPrice: "" };
}

function newBatch(levelKey: string): BatchRow {
  return { key: key(), batchNumber: "", manufacturingDate: "", expiryDate: "", receivingDate: today(), supplierId: "", supplierBatchRef: "", regulatoryNumber: "", levelKey, quantity: "", unitCost: "" };
}

export function ProductForm({
  catalog,
  outlets,
  defaultOutletId,
  suppliers,
  registrationStatuses,
  canOpenStock,
  scope,
}: {
  catalog: ProductCatalogLists;
  outlets: Option[];
  defaultOutletId: string | null;
  suppliers: Option[];
  registrationStatuses: string[];
  canOpenStock: boolean;
  scope?: string;
}) {
  const router = useRouter();
  const { run, error, setError, busy } = useAction();
  const [showErrors, setShowErrors] = useState(false);

  // A. General
  const [general, setGeneral] = useState({
    name: "",
    sku: "",
    genericName: "",
    category: "",
    productType: "",
    dosageForm: "",
    strength: "",
    size: "",
    manufacturer: "",
    supplierId: "",
    description: "",
    outletId: defaultOutletId ?? outlets[0]?.id ?? "",
    lifecycle: "ACTIVE",
    rxOnly: false,
    controlled: false,
    minStock: "20",
    maxStock: "",
  });
  const setG = (field: keyof typeof general) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setGeneral((current) => ({ ...current, [field]: event.target.value }));

  // E. Packaging (largest first; the last row is the base unit)
  const [levels, setLevels] = useState<LevelRow[]>(() => [newLevel("Tablet")]);
  // B. Barcodes
  const [barcodeMode, setBarcodeMode] = useState<"none" | "manufacturer" | "internal">("none");
  const [barcodeRows, setBarcodeRows] = useState<BarcodeRow[]>([]);
  const [internalLevels, setInternalLevels] = useState<string[]>([]);
  // F. Pricing (per base unit)
  const [pricing, setPricing] = useState({ purchasePrice: "", sellingPrice: "", wholesalePrice: "", minSellingPrice: "" });
  // D. Regulatory
  const [regulatory, setRegulatory] = useState({ nafdacNumber: "", status: "", approvalDate: "", renewalDate: "", expiryDate: "", localRepresentative: "", notes: "" });
  const setR = (field: keyof typeof regulatory) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setRegulatory((current) => ({ ...current, [field]: event.target.value }));
  // C/G. Opening batches
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);

  const baseRow = levels[levels.length - 1];
  const levelIndex = (levelKey: string) => Math.max(0, levels.findIndex((row) => row.key === levelKey));

  const built = useMemo((): { levels: PackagingLevel[] | null; error: string | null } => {
    try {
      return { levels: buildPackaging(levels.map((row) => ({ name: row.name, contains: Number(row.contains), sellable: row.sellable, purchasePrice: num(row.purchasePrice), sellingPrice: num(row.sellingPrice), wholesalePrice: num(row.wholesalePrice), minSellingPrice: num(row.minSellingPrice) }))), error: null };
    } catch (problem) {
      return { levels: null, error: problem instanceof Error ? problem.message : "Invalid packaging." };
    }
  }, [levels]);

  // Base-unit prices: entered directly, or derived from the first package that has one.
  const basePrices = useMemo(() => {
    const result: Record<"purchasePrice" | "sellingPrice" | "wholesalePrice" | "minSellingPrice", number | undefined> = { purchasePrice: undefined, sellingPrice: undefined, wholesalePrice: undefined, minSellingPrice: undefined };
    for (const field of Object.keys(result) as (keyof typeof result)[]) {
      const direct = num(pricing[field]);
      if (direct && direct > 0) result[field] = direct;
      else if (built.levels) {
        const priced = built.levels.find((level) => (level[field] ?? 0) > 0);
        if (priced) result[field] = (priced[field] as number) / priced.unitsPerPackage;
      }
    }
    return result;
  }, [pricing, built.levels]);

  const priceFor = (level: PackagingLevel, field: keyof typeof basePrices) => {
    const own = level[field];
    if (own && own > 0) return own;
    const unit = basePrices[field];
    return unit ? Math.round(unit * level.unitsPerPackage * 100) / 100 : undefined;
  };

  const openingTotal = built.levels
    ? batchRows.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (built.levels![levelIndex(row.levelKey)]?.unitsPerPackage ?? 1), 0)
    : 0;
  const openingValue = built.levels
    ? batchRows.reduce((sum, row) => {
        const level = built.levels![levelIndex(row.levelKey)];
        if (!level) return sum;
        const cost = num(row.unitCost) ?? priceFor(level, "purchasePrice") ?? 0;
        return sum + (Number(row.quantity) || 0) * cost;
      }, 0)
    : 0;

  // ---------------------------------------------------------------- validation
  const errors = useMemo(() => {
    const result: Record<SectionId, string[]> = { general: [], barcode: [], packaging: [], pricing: [], regulatory: [], stock: [] };
    if (general.name.trim().length < 2) result.general.push("Enter the product name.");
    if (!general.category) result.general.push("Choose a category.");
    if (!general.outletId) result.general.push("Choose the outlet/store.");
    if (general.controlled && !general.rxOnly) result.general.push("Controlled drugs must also be prescription-only.");
    const minStock = Number(general.minStock);
    if (!Number.isInteger(minStock) || minStock < 0) result.general.push("Reorder level must be a whole number.");
    if (general.maxStock && Number(general.maxStock) < minStock) result.general.push("Maximum stock cannot be below the reorder level.");

    if (built.error) result.packaging.push(built.error);
    else if (!built.levels?.some((level) => level.sellable)) result.packaging.push("At least one packaging level must be sellable.");

    if (barcodeMode === "manufacturer") {
      if (barcodeRows.length === 0) result.barcode.push("Add at least one manufacturer barcode, or choose another option.");
      const seen = new Set<string>();
      for (const row of barcodeRows) {
        const code = normaliseBarcode(row.code);
        const levelName = levels[levelIndex(row.levelKey)]?.name || "level";
        if (!code) result.barcode.push(`Enter the barcode for the ${levelName}.`);
        else {
          const problem = barcodeError(code, row.format || detectBarcodeFormat(code));
          if (problem) result.barcode.push(problem);
          if (seen.has(code)) result.barcode.push(`Barcode ${code} is entered twice.`);
          seen.add(code);
        }
      }
    }
    if (barcodeMode === "internal" && internalLevels.length === 0) result.barcode.push("Tick at least one packaging level to generate a barcode for.");

    if (!basePrices.purchasePrice) result.pricing.push(`Enter a purchase price per ${baseRow.name || "base unit"} or for a package.`);
    if (!basePrices.sellingPrice) result.pricing.push(`Enter a selling price per ${baseRow.name || "base unit"} or for a package.`);
    if (built.levels && basePrices.purchasePrice && basePrices.sellingPrice) {
      for (const level of built.levels) {
        const cost = priceFor(level, "purchasePrice") ?? 0;
        const sell = priceFor(level, "sellingPrice") ?? 0;
        const minimum = priceFor(level, "minSellingPrice");
        if (sell < cost - 0.005) result.pricing.push(`${level.name}: selling price is below cost.`);
        if (minimum !== undefined && minimum > sell + 0.005) result.pricing.push(`${level.name}: minimum price is above the selling price.`);
      }
    }

    const nafdac = regulatory.nafdacNumber.trim().toUpperCase();
    if (nafdac && nafdac !== "PENDING" && !/^[A-Z0-9]{2}-\d{4,6}$/.test(nafdac)) result.regulatory.push("NAFDAC number must look like A4-12345.");
    if (regulatory.approvalDate && regulatory.expiryDate && regulatory.expiryDate <= regulatory.approvalDate) result.regulatory.push("Registration expiry must be after the approval date.");

    const batchNumbers = new Set<string>();
    batchRows.forEach((row, index) => {
      const label = `Batch ${index + 1}`;
      const number = row.batchNumber.trim().toUpperCase();
      if (!number) result.stock.push(`${label}: enter the batch/lot number.`);
      if (number && batchNumbers.has(number)) result.stock.push(`${label}: batch ${number} is entered twice.`);
      batchNumbers.add(number);
      if (!row.expiryDate) result.stock.push(`${label}: expiry date is required.`);
      else if (row.expiryDate <= today()) result.stock.push(`${label}: the batch has expired and cannot be taken on as stock.`);
      if (row.manufacturingDate && row.manufacturingDate > today()) result.stock.push(`${label}: manufacturing date is in the future.`);
      if (row.manufacturingDate && row.expiryDate && row.expiryDate <= row.manufacturingDate) result.stock.push(`${label}: expiry must be after manufacture.`);
      if (!Number.isInteger(Number(row.quantity)) || Number(row.quantity) <= 0) result.stock.push(`${label}: enter a whole-number quantity.`);
    });
    return result;
    // priceFor depends on basePrices, already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [general, built, barcodeMode, barcodeRows, internalLevels, basePrices, regulatory, batchRows, levels]);

  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0);

  // ---------------------------------------------------------------- packaging row actions
  function addLargerPackage() {
    const suggestion = ["Strip", "Pack", "Box", "Carton"].find((name) => !levels.some((row) => row.name.toLowerCase() === name.toLowerCase())) ?? "";
    setLevels((current) => [newLevel(suggestion, "10"), ...current]);
  }
  function updateLevel(rowKey: string, patch: Partial<LevelRow>) {
    setLevels((current) => current.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  }
  function removeLevel(rowKey: string) {
    setLevels((current) => (current.length > 1 ? current.filter((row) => row.key !== rowKey) : current));
    setBarcodeRows((current) => current.filter((row) => row.levelKey !== rowKey));
    setInternalLevels((current) => current.filter((value) => value !== rowKey));
    setBatchRows((current) => current.map((row) => (row.levelKey === rowKey ? { ...row, levelKey: baseRow.key } : row)));
  }
  function moveLevel(index: number, delta: -1 | 1) {
    setLevels((current) => {
      const target = index + delta;
      // The base unit always stays last.
      if (target < 0 || target >= current.length - 1 || index >= current.length - 1) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submit() {
    setShowErrors(true);
    setError(null);
    const first = SECTIONS.find((section) => errors[section.id].length);
    if (first) {
      document.getElementById(first.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const payload = {
      name: general.name.trim(),
      sku: general.sku.trim() || undefined,
      genericName: general.genericName,
      category: general.category,
      productType: general.productType || undefined,
      dosageForm: general.dosageForm || undefined,
      strength: general.strength,
      size: general.size,
      manufacturer: general.manufacturer,
      supplierId: general.supplierId || undefined,
      description: general.description,
      outletId: general.outletId,
      lifecycle: general.lifecycle,
      rxOnly: general.rxOnly,
      controlled: general.controlled,
      minStock: Number(general.minStock) || 0,
      maxStock: general.maxStock ? Number(general.maxStock) : undefined,
      packaging: levels.map((row, index) => ({
        name: row.name.trim(),
        contains: index === levels.length - 1 ? 1 : Number(row.contains),
        sellable: row.sellable,
        purchasePrice: priceOrNull(row.purchasePrice),
        sellingPrice: priceOrNull(row.sellingPrice),
        wholesalePrice: priceOrNull(row.wholesalePrice),
        minSellingPrice: priceOrNull(row.minSellingPrice),
      })),
      pricing: {
        purchasePrice: priceOrNull(pricing.purchasePrice),
        sellingPrice: priceOrNull(pricing.sellingPrice),
        wholesalePrice: priceOrNull(pricing.wholesalePrice),
        minSellingPrice: priceOrNull(pricing.minSellingPrice),
      },
      barcodeMode,
      barcodes:
        barcodeMode === "manufacturer"
          ? barcodeRows.map((row) => ({ code: normaliseBarcode(row.code), format: row.format || undefined, packagingIndex: levelIndex(row.levelKey) }))
          : barcodeMode === "internal"
            ? internalLevels.map((levelKey) => ({ packagingIndex: levelIndex(levelKey) }))
            : [],
      regulatory: {
        nafdacNumber: regulatory.nafdacNumber.trim(),
        status: regulatory.status || undefined,
        approvalDate: regulatory.approvalDate || undefined,
        renewalDate: regulatory.renewalDate || undefined,
        expiryDate: regulatory.expiryDate || undefined,
        localRepresentative: regulatory.localRepresentative,
        notes: regulatory.notes,
      },
      openingStock: batchRows.map((row) => ({
        batchNumber: row.batchNumber.trim(),
        manufacturingDate: row.manufacturingDate,
        expiryDate: row.expiryDate,
        receivingDate: row.receivingDate || undefined,
        supplierId: row.supplierId || undefined,
        supplierBatchRef: row.supplierBatchRef,
        regulatoryNumber: row.regulatoryNumber,
        packagingIndex: levelIndex(row.levelKey),
        quantity: Number(row.quantity),
        unitCost: priceOrNull(row.unitCost),
      })),
    };
    const created = await run<{ id: string }>("/api/products", "POST", payload);
    if (created?.id) router.push(`/products/${created.id}`);
  }

  const levelOptions = levels.map((row) => ({ value: row.key, label: row.name || "(unnamed)" }));
  const visible = (section: SectionId) => (showErrors ? errors[section] : []);

  return (
    <div className="space-y-6 pb-4">
      <div className="flex items-start gap-3">
        <Link href="/products" className="mt-1 rounded-lg border border-slate-800 p-2 text-slate-300 hover:bg-slate-800" aria-label="Back to inventory">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">Inventory</p>
          <h3 className="text-2xl font-bold text-white">Register product</h3>
          <p className="text-sm text-slate-400">
            Create the item master record for one outlet{scope ? ` (${scope})` : ""}. Stock is counted in the base unit; packaging levels convert automatically.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Form sections">
          <ol className="sticky top-4 space-y-1 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-sm">
            {SECTIONS.map((section, index) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-slate-300 hover:bg-slate-800 hover:text-white">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-800 text-[11px] text-slate-300">{index + 1}</span>
                  <span className="flex-1">{section.title}</span>
                  {showErrors && errors[section.id].length ? <span className="h-2 w-2 rounded-full bg-rose-400" aria-label="Has errors" /> : null}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-6">
          {/* A. General */}
          <Section id="general" icon={Info} title="General information" errors={visible("general")}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Product name" className="md:col-span-2"><TextInput value={general.name} onChange={setG("name")} placeholder="e.g. Amoxil 500mg Capsules" /></Field>
              <Field label="Product code / SKU" hint="Leave blank to generate"><TextInput value={general.sku} onChange={setG("sku")} placeholder="e.g. AMX-500-CAP" /></Field>
              <Field label="Generic name"><TextInput value={general.genericName} onChange={setG("genericName")} placeholder="Amoxicillin" /></Field>
              <Field label="Category"><SelectInput value={general.category} onChange={setG("category")} options={[{ value: "", label: "Select category" }, ...catalog.categories.map((value) => ({ value, label: value }))]} /></Field>
              <Field label="Product type"><SelectInput value={general.productType} onChange={setG("productType")} options={[{ value: "", label: "Select type" }, ...catalog.productTypes.map((value) => ({ value, label: value }))]} /></Field>
              <Field label="Dosage form">
                <SelectInput
                  value={general.dosageForm}
                  onChange={(event) => {
                    const form = event.target.value;
                    setGeneral((current) => ({ ...current, dosageForm: form }));
                    // Suggest the base unit from the dosage form while it is still the default.
                    if (form && levels.length === 1 && ["Tablet", ""].includes(baseRow.name)) updateLevel(baseRow.key, { name: ["Syrup", "Suspension", "Drops"].includes(form) ? "Bottle" : ["Injection", "Infusion"].includes(form) ? "Vial" : ["Cream", "Ointment", "Gel"].includes(form) ? "Tube" : form === "Capsule" ? "Capsule" : form === "Tablet" ? "Tablet" : "Piece" });
                  }}
                  options={[{ value: "", label: "Select dosage form" }, ...catalog.dosageForms.map((value) => ({ value, label: value }))]}
                />
              </Field>
              <Field label="Strength / concentration"><TextInput value={general.strength} onChange={setG("strength")} placeholder="500mg · 250mg/5ml" /></Field>
              <Field label="Size / weight"><TextInput value={general.size} onChange={setG("size")} placeholder="100ml · 500g" /></Field>
              <Field label="Manufacturer"><TextInput value={general.manufacturer} onChange={setG("manufacturer")} placeholder="e.g. GSK Nigeria" /></Field>
              <Field label="Preferred supplier"><SelectInput value={general.supplierId} onChange={setG("supplierId")} options={[{ value: "", label: "None" }, ...suppliers.map((row) => ({ value: row.id, label: row.name }))]} /></Field>
              <Field label="Outlet / store" hint={outlets.length < 2 ? "Items belong to one outlet; register separately for others." : undefined}>
                <SelectInput value={general.outletId} disabled={outlets.length < 2} onChange={setG("outletId")} options={outlets.map((row) => ({ value: row.id, label: row.name }))} />
              </Field>
              <Field label="Product status">
                <SelectInput value={general.lifecycle} onChange={setG("lifecycle")} options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive (not sold)" }, { value: "DISCONTINUED", label: "Discontinued" }]} />
              </Field>
              <Field label="Reorder level" hint={`In ${baseRow.name || "base units"}`}><TextInput type="number" min={0} value={general.minStock} onChange={setG("minStock")} /></Field>
              <Field label="Maximum stock (optional)"><TextInput type="number" min={0} value={general.maxStock} onChange={setG("maxStock")} /></Field>
              <Field label="Description" className="md:col-span-2 xl:col-span-3">
                <textarea value={general.description} onChange={setG("description")} rows={2} className={`${inputClass} h-auto py-2`} placeholder="Indications, storage notes, shelf location…" />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-green-700" checked={general.rxOnly} onChange={(event) => setGeneral((current) => ({ ...current, rxOnly: event.target.checked, controlled: event.target.checked ? current.controlled : false }))} />
                Prescription-only (POM)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-green-700" checked={general.controlled} onChange={(event) => setGeneral((current) => ({ ...current, controlled: event.target.checked, rxOnly: event.target.checked ? true : current.rxOnly }))} />
                Controlled drug
              </label>
            </div>
          </Section>

          {/* B. Barcode */}
          <Section id="barcode" icon={Barcode} title="Barcode information" subtitle="Optional — barcodes can be added later from the product page." errors={visible("barcode")}>
            <div className="grid gap-3 md:grid-cols-3">
              <ModeCard active={barcodeMode === "none"} icon={Ban} title="No barcode" text="Sell by name search." onClick={() => setBarcodeMode("none")} />
              <ModeCard
                active={barcodeMode === "manufacturer"}
                icon={ScanLine}
                title="Use existing barcode"
                text="Scan the manufacturer code (EAN-13, UPC-A, Code 128)."
                onClick={() => {
                  setBarcodeMode("manufacturer");
                  if (barcodeRows.length === 0) setBarcodeRows([{ key: key(), levelKey: baseRow.key, code: "", format: "" }]);
                }}
              />
              <ModeCard
                active={barcodeMode === "internal"}
                icon={Sparkles}
                title="Generate internal barcode"
                text="Unique in-store EAN-13 (prefix 29)."
                onClick={() => {
                  setBarcodeMode("internal");
                  if (internalLevels.length === 0) setInternalLevels([baseRow.key]);
                }}
              />
            </div>

            {barcodeMode === "manufacturer" ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-slate-400">Different packaging levels often carry different barcodes (e.g. the carton and the single pack). Scanners type the code and press Enter.</p>
                {barcodeRows.map((row) => {
                  const code = normaliseBarcode(row.code);
                  const detected = code ? row.format || detectBarcodeFormat(code) : null;
                  const problem = code && detected ? barcodeError(code, detected) : null;
                  return (
                    <div key={row.key} className="grid gap-2 rounded-xl border border-slate-800 p-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end">
                      <Field label="Printed on"><SelectInput value={row.levelKey} onChange={(event) => setBarcodeRows((current) => current.map((item) => (item.key === row.key ? { ...item, levelKey: event.target.value } : item)))} options={levelOptions} /></Field>
                      <Field label="Barcode" hint={code ? (problem ? undefined : `${FORMAT_LABELS[detected!]} ✓`) : "Scan or type"}>
                        <TextInput
                          value={row.code}
                          inputMode="text"
                          onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
                          onChange={(event) => setBarcodeRows((current) => current.map((item) => (item.key === row.key ? { ...item, code: event.target.value } : item)))}
                          className={problem ? "border-rose-500" : ""}
                          placeholder="e.g. 5012345678900"
                        />
                      </Field>
                      <Field label="Format"><SelectInput value={row.format} onChange={(event) => setBarcodeRows((current) => current.map((item) => (item.key === row.key ? { ...item, format: event.target.value as BarcodeRow["format"] } : item)))} options={[{ value: "", label: "Auto-detect" }, ...Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label }))]} /></Field>
                      <IconButton label="Remove barcode" onClick={() => setBarcodeRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></IconButton>
                      {problem ? <p className="text-xs text-rose-300 sm:col-span-4">{problem}</p> : null}
                    </div>
                  );
                })}
                <ActionButton tone="secondary" onClick={() => setBarcodeRows((current) => [...current, { key: key(), levelKey: levels[0].key, code: "", format: "" }])}>
                  <Plus className="h-4 w-4" /> Add barcode for another packaging level
                </ActionButton>
              </div>
            ) : null}

            {barcodeMode === "internal" ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {levels.map((row) => (
                  <label key={row.key} className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-green-700"
                      checked={internalLevels.includes(row.key)}
                      onChange={(event) => setInternalLevels((current) => (event.target.checked ? [...current, row.key] : current.filter((value) => value !== row.key)))}
                    />
                    {row.name || "(unnamed)"}
                  </label>
                ))}
                <p className="w-full text-xs text-slate-400">A barcode is generated for each ticked level when you register. Print labels from the product page.</p>
              </div>
            ) : null}
          </Section>

          {/* E. Packaging */}
          <Section id="packaging" icon={Boxes} title="Packaging configuration" subtitle="List packages from largest to smallest. The last row is the base unit stock is counted in." errors={visible("packaging")}>
            <datalist id="packaging-types">{catalog.packagingTypes.map((value) => <option key={value} value={value} />)}</datalist>
            <div className="space-y-2">
              {levels.map((row, index) => {
                const isBase = index === levels.length - 1;
                const next = levels[index + 1];
                const units = built.levels?.[index]?.unitsPerPackage;
                return (
                  <div key={row.key} className={`grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto_auto] sm:items-end ${isBase ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800"}`}>
                    <Field label={isBase ? "Base unit" : `Level ${index + 1}`}>
                      <TextInput list="packaging-types" value={row.name} onChange={(event) => updateLevel(row.key, { name: event.target.value })} placeholder={isBase ? "Tablet, Bottle, Piece…" : "Carton, Pack, Strip…"} />
                    </Field>
                    {isBase ? (
                      <p className="pb-2 text-xs text-slate-400">Smallest unit sold or counted. Batch quantities and the ledger use this unit.</p>
                    ) : (
                      <Field label={`Contains (${next?.name || "next level"})`} hint={units ? `= ${units.toLocaleString()} ${baseRow.name || "base units"}` : undefined}>
                        <TextInput type="number" min={2} value={row.contains} onChange={(event) => updateLevel(row.key, { contains: event.target.value })} />
                      </Field>
                    )}
                    <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
                      <input type="checkbox" className="h-4 w-4 accent-green-700" checked={row.sellable} onChange={(event) => updateLevel(row.key, { sellable: event.target.checked })} />
                      Sell by {row.name ? row.name.toLowerCase() : "this level"}
                    </label>
                    <div className="flex gap-1 pb-1">
                      {!isBase ? (
                        <>
                          <IconButton label="Move up" disabled={index === 0} onClick={() => moveLevel(index, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
                          <IconButton label="Move down" disabled={index >= levels.length - 2} onClick={() => moveLevel(index, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
                          <IconButton label="Remove level" onClick={() => removeLevel(row.key)}><Trash2 className="h-4 w-4" /></IconButton>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <ActionButton tone="secondary" onClick={addLargerPackage} disabled={levels.length >= 6}>
                <PackagePlus className="h-4 w-4" /> Add larger package
              </ActionButton>
              {built.levels && built.levels.length > 1 ? (
                <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-200">{describeConversion(built.levels)}</p>
              ) : null}
            </div>
          </Section>

          {/* F. Pricing */}
          <Section id="pricing" icon={CircleDollarSign} title="Pricing" subtitle={`Enter prices per ${baseRow.name || "base unit"}, or for any package and leave the base blank to calculate it. Override a package price to sell it at a different rate.`} errors={visible("pricing")}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(["purchasePrice", "sellingPrice", "wholesalePrice", "minSellingPrice"] as const).map((field) => (
                <Field key={field} label={`${{ purchasePrice: "Purchase", sellingPrice: "Selling", wholesalePrice: "Wholesale", minSellingPrice: "Minimum selling" }[field]} price / ${baseRow.name || "unit"} (₦)`} hint={!pricing[field] && basePrices[field] ? `Calculated: ${money(Math.round(basePrices[field]! * 100) / 100)}` : field === "wholesalePrice" || field === "minSellingPrice" ? "Optional" : undefined}>
                  <TextInput type="number" min={0} step="0.01" value={pricing[field]} onChange={(event) => setPricing((current) => ({ ...current, [field]: event.target.value }))} />
                </Field>
              ))}
            </div>
            {built.levels ? (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-950/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Package</th>
                      <th className="px-3 py-2 text-right">{baseRow.name || "Units"}</th>
                      <th className="px-3 py-2">Purchase (₦)</th>
                      <th className="px-3 py-2">Selling (₦)</th>
                      <th className="px-3 py-2">Wholesale (₦)</th>
                      <th className="px-3 py-2">Minimum (₦)</th>
                      <th className="px-3 py-2 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {built.levels.map((level, index) => {
                      const row = levels[index];
                      const cost = priceFor(level, "purchasePrice");
                      const sell = priceFor(level, "sellingPrice");
                      return (
                        <tr key={row.key}>
                          <td className="px-3 py-2 text-white">{level.name}{!level.sellable ? <span className="ml-2 text-[11px] text-slate-500">not sold</span> : null}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-300">{level.unitsPerPackage.toLocaleString()}</td>
                          {(["purchasePrice", "sellingPrice", "wholesalePrice", "minSellingPrice"] as const).map((field) => (
                            <td key={field} className="px-3 py-2">
                              {level.isBase ? (
                                <span className="tabular-nums text-slate-300">{priceFor(level, field) !== undefined ? money(priceFor(level, field)!) : "—"}</span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={row[field]}
                                  placeholder={priceFor({ ...level, [field]: undefined }, field)?.toString() ?? ""}
                                  onChange={(event) => updateLevel(row.key, { [field]: event.target.value })}
                                  className="h-8 w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 text-right text-white placeholder:text-slate-600"
                                  aria-label={`${level.name} ${field}`}
                                />
                              )}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right tabular-nums">{cost && sell ? <span className={(sell - cost) / sell < 0.2 ? "text-amber-300" : "text-emerald-300"}>{Math.round(((sell - cost) / sell) * 1000) / 10}%</span> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">Grey figures are calculated from the base price. Price changes later are kept in the price history; past sales keep the price they were sold at.</p>
              </div>
            ) : null}
          </Section>

          {/* D. Regulatory */}
          <Section id="regulatory" icon={ShieldCheck} title="Regulatory information" subtitle="Creates the product's entry on the regulatory register. Supporting documents are uploaded on the Regulatory page." errors={visible("regulatory")}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="NAFDAC registration no." hint="Format A4-12345. Leave blank while pending."><TextInput value={regulatory.nafdacNumber} onChange={setR("nafdacNumber")} placeholder="A4-12345" /></Field>
              <Field label="Regulatory status"><SelectInput value={regulatory.status} onChange={setR("status")} options={[{ value: "", label: "Auto (Registered / Pending)" }, ...registrationStatuses.map((value) => ({ value, label: value }))]} /></Field>
              <Field label="Local representative / company"><TextInput value={regulatory.localRepresentative} onChange={setR("localRepresentative")} placeholder="Marketing authorisation holder" /></Field>
              <Field label="Registration / approval date"><TextInput type="date" value={regulatory.approvalDate} onChange={setR("approvalDate")} /></Field>
              <Field label="Renewal date"><TextInput type="date" value={regulatory.renewalDate} onChange={setR("renewalDate")} /></Field>
              <Field label="Registration expiry date"><TextInput type="date" value={regulatory.expiryDate} onChange={setR("expiryDate")} /></Field>
              <Field label="Notes" className="md:col-span-2 xl:col-span-3"><TextInput value={regulatory.notes} onChange={setR("notes")} placeholder="Conditions of registration, variations…" /></Field>
            </div>
          </Section>

          {/* C + G. Batch, expiry & opening stock */}
          <Section
            id="stock"
            icon={CalendarClock}
            title="Batch, expiry & opening stock"
            subtitle="Optional. Each batch keeps its own expiry and quantity; sales use first-expiry-first-out. Later deliveries are received on the Batches & GRN page."
            errors={visible("stock")}
          >
            {!canOpenStock ? (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">Opening stock needs the “Approve stock movements” permission. Register the item, then receive stock through a goods receipt.</p>
            ) : (
              <div className="space-y-3">
                {batchRows.map((row, index) => {
                  const level = built.levels?.[levelIndex(row.levelKey)];
                  const update = (patch: Partial<BatchRow>) => setBatchRows((current) => current.map((item) => (item.key === row.key ? { ...item, ...patch } : item)));
                  const baseQty = level ? (Number(row.quantity) || 0) * level.unitsPerPackage : 0;
                  return (
                    <div key={row.key} className="rounded-xl border border-slate-800 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium text-white">Batch {index + 1}</p>
                        <IconButton label="Remove batch" onClick={() => setBatchRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></IconButton>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Field label="Batch / lot number"><TextInput value={row.batchNumber} onChange={(event) => update({ batchNumber: event.target.value })} placeholder="BN-2026-014" /></Field>
                        <Field label="Manufacturing date"><TextInput type="date" value={row.manufacturingDate} onChange={(event) => update({ manufacturingDate: event.target.value })} /></Field>
                        <Field label="Expiry date"><TextInput type="date" value={row.expiryDate} onChange={(event) => update({ expiryDate: event.target.value })} /></Field>
                        <Field label="Receiving date"><TextInput type="date" value={row.receivingDate} onChange={(event) => update({ receivingDate: event.target.value })} /></Field>
                        <Field label="Supplier"><SelectInput value={row.supplierId} onChange={(event) => update({ supplierId: event.target.value })} options={[{ value: "", label: "Opening stock (no supplier)" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} /></Field>
                        <Field label="Supplier batch reference"><TextInput value={row.supplierBatchRef} onChange={(event) => update({ supplierBatchRef: event.target.value })} placeholder="Supplier's own reference" /></Field>
                        <Field label="NAFDAC no. on batch" hint="Defaults to the product's number"><TextInput value={row.regulatoryNumber} onChange={(event) => update({ regulatoryNumber: event.target.value })} placeholder={regulatory.nafdacNumber || "A4-12345"} /></Field>
                        <div className="grid grid-cols-[1fr_1.2fr] gap-2">
                          <Field label="Quantity" hint={level && level.unitsPerPackage > 1 && baseQty ? `= ${baseQty.toLocaleString()} ${baseRow.name}` : undefined}>
                            <TextInput type="number" min={1} value={row.quantity} onChange={(event) => update({ quantity: event.target.value })} />
                          </Field>
                          <Field label="Counted in"><SelectInput value={row.levelKey} onChange={(event) => update({ levelKey: event.target.value })} options={levelOptions} /></Field>
                        </div>
                        <Field label={`Cost per ${level?.name.toLowerCase() || "unit"} (₦)`} hint={level && !row.unitCost && priceFor(level, "purchasePrice") ? `Default ${money(priceFor(level, "purchasePrice")!)}` : undefined}>
                          <TextInput type="number" min={0} step="0.01" value={row.unitCost} onChange={(event) => update({ unitCost: event.target.value })} />
                        </Field>
                      </div>
                    </div>
                  );
                })}
                <ActionButton tone="secondary" onClick={() => setBatchRows((current) => [...current, newBatch(levels[0].key)])}>
                  <Plus className="h-4 w-4" /> Add opening batch
                </ActionButton>
                {batchRows.length ? (
                  <div className="grid gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:grid-cols-3">
                    <Total label="Opening stock" value={`${openingTotal.toLocaleString()} ${baseRow.name || "units"}`} note={built.levels && built.levels.length > 1 ? describeBreakdown(openingTotal, built.levels) : undefined} />
                    <Total label="Batches" value={String(batchRows.length)} note="Posted as OPENING ledger entries" />
                    <Total label="Stock value (cost)" value={money(Math.round(openingValue))} />
                  </div>
                ) : null}
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* Sticky action area */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 text-sm">
            {error ? <FormError message={error} /> : showErrors && errorCount ? (
              <p className="text-rose-300">{errorCount} issue{errorCount === 1 ? "" : "s"} to fix — see the highlighted sections.</p>
            ) : (
              <p className="truncate text-slate-400">
                {general.name || "New product"} · base unit {baseRow.name || "—"}
                {built.levels && built.levels.length > 1 ? ` · ${describeConversion(built.levels)}` : ""}
                {openingTotal ? ` · opening ${openingTotal.toLocaleString()}` : ""}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Link href="/products" className="inline-flex h-9 items-center rounded-lg border border-slate-700 px-3 text-sm text-slate-100 hover:bg-slate-800">Cancel</Link>
            <ActionButton disabled={busy} onClick={() => void submit()}>{busy ? "Registering…" : "Register product"}</ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ id, icon: Icon, title, subtitle, errors, children }: { id: string; icon: LucideIcon; title: string; subtitle?: string; errors: string[]; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-4 rounded-2xl border bg-slate-900/70 ${errors.length ? "border-rose-500/50" : "border-slate-800"}`}>
      <header className="border-b border-slate-800 px-5 py-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
          <Icon className="h-4 w-4" /> {title}
        </h4>
        {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
      </header>
      <div className="p-5">
        {errors.length ? (
          <ul className="mb-4 space-y-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">
            {errors.map((message) => <li key={message}>• {message}</li>)}
          </ul>
        ) : null}
        {children}
      </div>
    </section>
  );
}

function ModeCard({ active, icon: Icon, title, text, onClick }: { active: boolean; icon: LucideIcon; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${active ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500/20" : "border-slate-800 hover:border-slate-600"}`}
    >
      <span className={`rounded-full p-2 ${active ? "bg-blue-600 text-[#fff]" : "bg-slate-800 text-slate-300"}`}><Icon className="h-4 w-4" /></span>
      <span>
        <span className="block font-medium text-white">{title}</span>
        <span className="block text-xs text-slate-400">{text}</span>
      </span>
    </button>
  );
}

function IconButton({ label, children, ...props }: React.ComponentProps<"button"> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...props} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30">
      {children}
    </button>
  );
}

function Total({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
      {note ? <p className="text-xs text-slate-400">{note}</p> : null}
    </div>
  );
}
