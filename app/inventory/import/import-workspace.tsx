"use client";

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, History, Loader2, PackagePlus, RefreshCcw, Upload, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid, type Stat } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";

type Kind = "catalogue" | "stock" | "both";
type FieldInfo = { key: string; label: string; modes: Kind[]; description: string };
type Decision = { action: "match"; productId: string } | { action: "create" } | { action: "skip" };
type Card = { id?: string; name: string; genericName?: string; strength?: string; dosageForm?: string; category?: string; barcode?: string; sku?: string; baseUnit?: string; packaging?: string; purchasePrice?: number; sellingPrice?: number; stock?: number; outlet?: string };
type Row = {
  index: number;
  row: number;
  values: Record<string, string>;
  edited: boolean;
  status: "ready" | "warning" | "review" | "error" | "skipped";
  errors: string[];
  warnings: string[];
  notes: string[];
  outletName?: string;
  action: "create" | "match" | "review" | "none";
  productName: string;
  productId?: string;
  matchedBy?: string;
  incoming: Card;
  existing?: Card;
  candidates?: Card[];
  batch?: { batchNumber: string; expiryDate: string; manufacturingDate?: string; quantity: number; unit: string; baseQuantity: number; baseUnit: string; unitCost: number; conversion: string };
  decision?: Decision;
};
type Summary = Record<string, number> & { newCategories?: string[] };
type Detail = {
  id: string;
  reference: string;
  kind: Kind;
  status: string;
  fileName: string;
  rowCount: number;
  outletId: string | null;
  headers?: string[];
  sample?: string[][];
  mapping?: Record<string, number>;
  suggestions?: Record<string, { index: number; reason: string }[]>;
  options?: { outletId: string; dateFormat: "DMY" | "MDY"; priceBasis: "base" | "unit" } | null;
  edits?: Record<string, Record<string, string>>;
  decisions?: Record<string, Decision>;
  previous?: { reference: string; at: string | null } | null;
  token?: string | null;
  preview?: { summary: Summary; rows: Row[]; token: string | null } | null;
  nextChunk: number;
  chunkCount: number;
  summary: Record<string, unknown>;
  done?: boolean;
};

const PAGE = 100;
const fmt = (value: number | undefined) => (value ?? 0).toLocaleString("en-NG");
const naira = (value: number | undefined) => (value === undefined ? "—" : `₦${value.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`);

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status}).`);
  return payload;
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const STATUS_LABEL: Record<Row["status"], string> = { ready: "Ready", warning: "Warning", review: "Needs decision", error: "Rejected", skipped: "Skipped" };
const STATUS_TONE = { ready: "emerald", warning: "amber", review: "sky", error: "rose", skipped: "slate" } as const;

export function ImportWorkspace({
  initialId,
  outlets,
  defaultOutletId,
  scope,
  fields,
  kindLabels,
  limits,
  canAddCatalog,
}: {
  initialId: string | null;
  outlets: { id: string; name: string; code: string }[];
  defaultOutletId: string;
  scope?: string;
  fields: FieldInfo[];
  kindLabels: Record<Kind, string>;
  limits: { maxBytes: number; maxRows: number };
  canAddCatalog: boolean;
}) {
  const [kind, setKind] = useState<Kind>("both");
  const [outletId, setOutletId] = useState(defaultOutletId);
  const [file, setFile] = useState<File | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [autoMapped, setAutoMapped] = useState<Record<string, number>>({});
  const [dateFormat, setDateFormat] = useState<"DMY" | "MDY">("DMY");
  const [priceBasis, setPriceBasis] = useState<"base" | "unit">("base");
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [step, setStep] = useState<"upload" | "map" | "preview" | "importing" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Row["status"]>("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<{ part: number; total: number } | null>(null);

  const load = useCallback((next: Detail) => {
    setDetail(next);
    setKind(next.kind);
    if (next.mapping) {
      setMapping(next.mapping);
      if (next.status === "DRAFT") setAutoMapped(next.mapping);
    }
    if (next.options) {
      setOutletId(next.options.outletId);
      setDateFormat(next.options.dateFormat);
      setPriceBasis(next.options.priceBasis);
    }
    if (next.edits) setEdits(next.edits);
    if (next.decisions) setDecisions(next.decisions);
    if (next.status === "COMPLETED" || next.status === "ROLLED_BACK") setStep("done");
    else if (next.status === "IN_PROGRESS") setStep("importing");
    else if (next.preview) setStep("preview");
    else setStep("map");
  }, []);

  useEffect(() => {
    if (!initialId) return;
    call<Detail>(`/api/inventory-imports/${encodeURIComponent(initialId)}`).then(load, (reason: Error) => setError(reason.message));
  }, [initialId, load]);

  const kindFields = useMemo(() => fields.filter((field) => field.modes.includes(kind)), [fields, kind]);
  const rows = useMemo(() => detail?.preview?.rows ?? [], [detail]);
  const visible = useMemo(() => (filter === "all" ? rows : rows.filter((row) => row.status === filter)), [rows, filter]);
  const summary = detail?.preview?.summary;
  const importableRows = rows.filter((row) => (row.status === "ready" || row.status === "warning") && (row.action === "create" || (row.action === "match" && row.batch && kind !== "catalogue"))).length;

  async function upload() {
    if (!file) return setError("Choose a file.");
    if (file.size > limits.maxBytes) return setError("The file is larger than 4 MB. Split it into smaller files.");
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const next = await call<Detail>("/api/inventory-imports", { method: "POST", body: form });
      setEdits({});
      setDecisions({});
      load(next);
      window.history.replaceState(null, "", `/inventory/import?id=${next.id}`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function preview(overrides: { edits?: typeof edits; decisions?: typeof decisions } = {}) {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const cleanMapping = Object.fromEntries(Object.entries(mapping).filter(([key, value]) => value !== null && value !== undefined && kindFields.some((field) => field.key === key)));
      const next = await call<Detail>(
        `/api/inventory-imports/${detail.id}/preview`,
        json({ kind, mapping: cleanMapping, options: { outletId, dateFormat, priceBasis }, edits: overrides.edits ?? edits, decisions: overrides.decisions ?? decisions }),
      );
      setDetail((current) => ({ ...current!, ...next }));
      setStep("preview");
      setConfirmed(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runImport(fromPart: number, total: number, token: string) {
    if (!detail) return;
    setStep("importing");
    setError(null);
    for (let part = fromPart; part < total; part += 1) {
      setProgress({ part, total });
      try {
        await call(`/api/inventory-imports/${detail.id}/commit`, json({ confirm: true, token, chunk: part }));
      } catch (reason) {
        setError((reason as Error).message);
        const fresh = await call<Detail>(`/api/inventory-imports/${detail.id}`).catch(() => null);
        if (fresh) {
          setDetail(fresh);
          if (fresh.status === "PREVIEWED") setStep("preview");
        }
        setProgress(null);
        return;
      }
    }
    setProgress(null);
    const fresh = await call<Detail>(`/api/inventory-imports/${detail.id}`);
    setDetail(fresh);
    setStep("done");
  }

  async function discard() {
    if (!detail || !window.confirm("Discard this upload? Nothing has been imported.")) return;
    try {
      await call(`/api/inventory-imports/${detail.id}`, { method: "DELETE" });
      reset();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  function reset() {
    setDetail(null);
    setFile(null);
    setMapping({});
    setEdits({});
    setDecisions({});
    setStep("upload");
    setError(null);
    window.history.replaceState(null, "", "/inventory/import");
  }

  function decide(row: Row, decision: Decision | null) {
    const next = { ...decisions };
    if (decision === null) delete next[String(row.index)];
    else next[String(row.index)] = decision;
    setDecisions(next);
    setSelected(null);
    void preview({ decisions: next });
  }

  function saveEdit(row: Row, values: Record<string, string>) {
    const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== (row.values[key] ?? "") || edits[String(row.index)]?.[key] !== undefined));
    const next = { ...edits };
    if (Object.keys(changed).length) next[String(row.index)] = { ...(next[String(row.index)] ?? {}), ...changed };
    setEdits(next);
    setSelected(null);
    void preview({ edits: next });
  }

  const stats: Stat[] = summary
    ? [
        { label: "Rows in file", value: fmt(summary.totalRows), note: `${fmt(summary.readyRows + summary.warningRows)} importable · ${fmt(summary.skippedRows)} skipped`, tone: "slate", icon: FileSpreadsheet },
        { label: "New products", value: fmt(summary.newProducts), note: summary.newCategories?.length ? `Adds to catalogue: ${summary.newCategories.join(", ")}` : undefined, tone: "emerald", icon: PackagePlus },
        { label: "Matched existing products", value: fmt(summary.matchedProducts), tone: "sky", icon: CheckCircle2 },
        ...(kind !== "catalogue" ? [{ label: "New batches", value: fmt(summary.newBatches), note: `${fmt(summary.openingQuantity)} base units of opening stock`, tone: "emerald" as const, icon: PackagePlus }] : []),
        { label: "Possible duplicates", value: fmt(summary.duplicateWarnings), note: `${fmt(summary.reviewRows)} need your decision`, tone: summary.reviewRows ? "amber" : "slate", icon: AlertTriangle },
        { label: "Rejected rows", value: fmt(summary.errorRows), note: `${fmt(summary.missingRequired)} missing information · ${fmt(summary.conversionIssues)} packaging issues`, tone: summary.errorRows ? "rose" : "slate", icon: XCircle },
        ...(kind !== "catalogue"
          ? [{ label: "Expiry", value: `${fmt(summary.expiredRows)} expired`, note: `${fmt(summary.nearExpiryRows)} near expiry (imported with a warning)`, tone: summary.expiredRows ? ("rose" as const) : ("slate" as const), icon: AlertTriangle }]
          : []),
        { label: "Rows with warnings", value: fmt(summary.warningRows), tone: summary.warningRows ? "amber" : "slate", icon: AlertTriangle },
      ]
    : [];

  const selectedRow = selected === null ? null : rows.find((row) => row.index === selected) ?? null;
  const resultSummary = detail?.summary as Record<string, number | string[]> | undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory"
        title="Bulk Import / Data Migration"
        description="Bring your product list and opening stock over from Excel, CSV or another pharmacy system. Nothing is saved until you have checked the preview and confirmed."
        scope={scope}
        actions={
          <>
            <Link href="/inventory/import/history" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800">
              <History className="h-4 w-4" /> Import history
            </Link>
            {detail && step !== "importing" ? (
              <ActionButton tone="ghost" onClick={reset}>
                <RefreshCcw className="h-4 w-4" /> New import
              </ActionButton>
            ) : null}
          </>
        }
      />

      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Steps">
        {(["upload", "map", "preview", "importing", "done"] as const).map((name, index) => (
          <li key={name} className={`rounded-full border px-3 py-1 ${step === name ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-slate-700 text-slate-400"}`}>
            {index + 1}. {{ upload: "Upload", map: "Match columns", preview: "Preview & correct", importing: "Import", done: "Report" }[name]}
          </li>
        ))}
      </ol>

      <FormError message={error} />

      {step === "upload" ? (
        <Panel title="1. Choose what to import" description={`Excel (.xlsx) or CSV, up to ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB and ${limits.maxRows.toLocaleString()} rows. Old .xls files must be saved as .xlsx first.`}>
          <div className="grid gap-3 md:grid-cols-3">
            {(["catalogue", "stock", "both"] as Kind[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                aria-pressed={kind === option}
                className={`rounded-xl border p-4 text-left transition ${kind === option ? "border-blue-500 bg-blue-500/10" : "border-slate-700 hover:border-slate-500"}`}
              >
                <p className="font-semibold text-white">{kindLabels[option]}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {option === "catalogue"
                    ? "Products, categories, brands, barcodes, codes, dosage forms, packaging, prices, reorder levels and suppliers."
                    : option === "stock"
                      ? "Batches of products already in PharmaERP: batch numbers, dates, quantities, costs and outlets."
                      : "New products and their opening batches from one file (one row per batch)."}
                </p>
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <Field label="Destination outlet" hint="Rows without an Outlet column go here.">
              <SelectInput value={outletId} onChange={(event) => setOutletId(event.target.value)} options={outlets.map((outlet) => ({ value: outlet.id, label: `${outlet.name} (${outlet.code})` }))} />
            </Field>
            <Field label="File">
              <input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-100"
              />
            </Field>
            <ActionButton onClick={upload} disabled={busy || !file || !outletId}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload and read file
            </ActionButton>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
            <span>Templates with sample rows and a column guide:</span>
            {(["xlsx", "csv"] as const).map((format) => (
              <a key={format} href={`/api/inventory-imports/template?kind=${kind}&format=${format}`} className="inline-flex items-center gap-1 text-blue-400 hover:underline">
                <Download className="h-4 w-4" /> {kindLabels[kind]} ({format.toUpperCase()})
              </a>
            ))}
          </div>
        </Panel>
      ) : null}

      {detail && step === "map" ? (
        <Panel
          title={`2. Match the columns of ${detail.fileName}`}
          description={`${detail.rowCount.toLocaleString()} rows · ${detail.reference}. Columns we recognised are filled in; check anything marked "Check", and leave out columns PharmaERP does not need.`}
          actions={<ActionButton tone="ghost" onClick={discard}>Discard</ActionButton>}
        >
          {detail.previous ? (
            <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              This exact file was already imported as {detail.previous.reference}. It cannot be imported again the same way unless that import is rolled back.
            </p>
          ) : null}
          <div className="mb-4 grid gap-4 md:grid-cols-4">
            <Field label="Import type">
              <SelectInput value={kind} onChange={(event) => setKind(event.target.value as Kind)} options={(["catalogue", "stock", "both"] as Kind[]).map((value) => ({ value, label: kindLabels[value] }))} />
            </Field>
            <Field label="Destination outlet">
              <SelectInput value={outletId} onChange={(event) => setOutletId(event.target.value)} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />
            </Field>
            <Field label="Dates are written" hint="Applies to dates like 05/06/2028.">
              <SelectInput value={dateFormat} onChange={(event) => setDateFormat(event.target.value as "DMY" | "MDY")} options={[{ value: "DMY", label: "Day/Month/Year" }, { value: "MDY", label: "Month/Day/Year" }]} />
            </Field>
            <Field label="Prices in the file are" hint="Converted to base-unit prices.">
              <SelectInput value={priceBasis} onChange={(event) => setPriceBasis(event.target.value as "base" | "unit")} options={[{ value: "base", label: "Per base unit (e.g. per tablet)" }, { value: "unit", label: "Per quantity unit (e.g. per carton)" }]} />
            </Field>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">PharmaERP field</th>
                  <th className="py-2 pr-3">Column in your file</th>
                  <th className="py-2 pr-3">Sample values</th>
                </tr>
              </thead>
              <tbody>
                {kindFields.map((field) => {
                  const column = mapping[field.key];
                  const suggestions = detail.suggestions?.[field.key] ?? [];
                  const auto = autoMapped[field.key] !== undefined && autoMapped[field.key] === column;
                  const required = (kind === "stock" ? ["batchNumber", "expiryDate", "quantity"] : ["name"]).includes(field.key);
                  return (
                    <tr key={field.key} className="border-b border-slate-800/60 align-top">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-white">
                          {field.label} {required ? <span className="text-rose-300">*</span> : null}
                        </p>
                        <p className="max-w-sm text-xs text-slate-500">{field.description}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={`Column for ${field.label}`}
                            value={column ?? ""}
                            onChange={(event) => setMapping({ ...mapping, [field.key]: event.target.value === "" ? null : Number(event.target.value) })}
                            className="h-9 w-56 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-white"
                          >
                            <option value="">— not in file —</option>
                            {detail.headers?.map((header, index) => (
                              <option key={index} value={index}>
                                {header}
                              </option>
                            ))}
                          </select>
                          {auto ? <StatusBadge status="Auto" tone="emerald" /> : null}
                          {column === null || column === undefined ? (suggestions.length ? <StatusBadge status="Check" tone="amber" /> : null) : !auto ? <StatusBadge status="Manual" tone="sky" /> : null}
                        </div>
                        {(column === null || column === undefined) && suggestions.length ? (
                          <div className="mt-1 flex flex-wrap gap-1 text-xs text-amber-200">
                            {suggestions.map((suggestion) => (
                              <button key={suggestion.index} type="button" className="rounded border border-amber-500/30 px-1.5 py-0.5 hover:bg-amber-500/10" onClick={() => setMapping({ ...mapping, [field.key]: suggestion.index })} title={suggestion.reason}>
                                Use “{detail.headers?.[suggestion.index]}”?
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-400">{column !== null && column !== undefined ? detail.sample?.map((row) => row[column]).filter(Boolean).slice(0, 3).join(" · ") : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!canAddCatalog ? <p className="mt-3 text-xs text-slate-500">Categories and dosage forms must already exist in Products → Categories (only central administrators can add new ones through an import).</p> : null}
          <div className="mt-4 flex justify-end">
            <ActionButton onClick={() => preview()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Build preview
            </ActionButton>
          </div>
        </Panel>
      ) : null}

      {detail && step === "preview" && summary ? (
        <>
          <StatGrid stats={stats} />
          <Panel
            title={`3. Preview of ${detail.fileName}`}
            description="Nothing has been saved yet. Click a row to correct it, or to decide on a possible duplicate."
            actions={
              <>
                <ActionButton tone="secondary" onClick={() => setStep("map")}>Back to columns</ActionButton>
                <a href={`/api/inventory-imports/${detail.id}/report?type=rejected`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 hover:bg-slate-800">
                  <Download className="h-4 w-4" /> Rejected rows (CSV)
                </a>
                <ActionButton tone="ghost" onClick={discard}>Discard</ActionButton>
              </>
            }
          >
            <div className="mb-3 flex flex-wrap gap-2">
              {(["all", "ready", "warning", "review", "error", "skipped"] as const).map((name) => {
                const count = name === "all" ? rows.length : rows.filter((row) => row.status === name).length;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setFilter(name);
                      setPage(0);
                    }}
                    className={`rounded-full border px-3 py-1 text-xs ${filter === name ? "border-blue-500 bg-blue-500/10 text-blue-200" : "border-slate-700 text-slate-300"}`}
                  >
                    {name === "all" ? "All" : STATUS_LABEL[name]} ({count})
                  </button>
                );
              })}
              {busy ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm" data-import-preview>
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-400">
                    <th className="py-2 pr-3">Row</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Product</th>
                    <th className="py-2 pr-3">Outlet</th>
                    {kind !== "catalogue" ? <th className="py-2 pr-3">Batch / expiry</th> : null}
                    {kind !== "catalogue" ? <th className="py-2 pr-3">Quantity (file → base units)</th> : null}
                    <th className="py-2 pr-3">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(page * PAGE, page * PAGE + PAGE).map((row) => (
                    <tr key={row.index} onClick={() => setSelected(row.index)} className="cursor-pointer border-b border-slate-800/60 align-top hover:bg-slate-800/40">
                      <td className="py-2 pr-3 tabular-nums text-slate-400">
                        {row.row}
                        {row.edited ? <span className="ml-1 text-[10px] text-sky-300">edited</span> : null}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={STATUS_LABEL[row.status]} tone={STATUS_TONE[row.status]} />
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-medium text-white">{row.productName || "—"}</p>
                        <p className="text-xs text-slate-400">
                          {row.action === "create" ? "New product" : row.action === "match" ? `Existing · matched by ${row.matchedBy}` : row.action === "review" ? "Possible duplicate" : ""}
                        </p>
                      </td>
                      <td className="py-2 pr-3 text-slate-300">{row.outletName ?? "—"}</td>
                      {kind !== "catalogue" ? (
                        <td className="py-2 pr-3 text-slate-300">
                          {row.batch ? (
                            <>
                              <p>{row.batch.batchNumber}</p>
                              <p className="text-xs text-slate-400">exp. {row.batch.expiryDate}</p>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                      {kind !== "catalogue" ? <td className="py-2 pr-3 text-slate-300">{row.batch ? row.batch.conversion : "—"}</td> : null}
                      <td className="max-w-md py-2 pr-3 text-xs">
                        {row.errors.map((message) => (
                          <p key={message} className="text-rose-300">{message}</p>
                        ))}
                        {row.warnings.map((message) => (
                          <p key={message} className="text-amber-200">{message}</p>
                        ))}
                        {row.notes.slice(0, 2).map((message) => (
                          <p key={message} className="text-slate-400">{message}</p>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length > PAGE ? (
              <div className="mt-3 flex items-center justify-end gap-2 text-sm text-slate-400">
                <ActionButton tone="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</ActionButton>
                <span>
                  {page * PAGE + 1}–{Math.min(visible.length, (page + 1) * PAGE)} of {visible.length}
                </span>
                <ActionButton tone="secondary" disabled={(page + 1) * PAGE >= visible.length} onClick={() => setPage(page + 1)}>Next</ActionButton>
              </div>
            ) : null}
          </Panel>

          <Panel title="4. Confirm the import" description="Stock is created as opening-balance entries in the stock ledger, batch by batch. You can roll the import back from Import History while none of it has been used.">
            {summary.reviewRows > 0 ? (
              <p className="mb-3 text-sm text-amber-200">{summary.reviewRows} row(s) are possible duplicates. Open each one and choose to match, create or skip before importing.</p>
            ) : null}
            {detail.previous ? <p className="mb-3 text-sm text-rose-300">This file was already imported as {detail.previous.reference}; the import will be refused.</p> : null}
            <label className="flex items-start gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
              <span>
                I have checked the preview. Import {fmt(importableRows)} row(s){kind !== "catalogue" ? ` (${fmt(summary.newBatches)} batches, ${fmt(summary.openingQuantity)} base units)` : ""} into PharmaERP. {fmt(summary.errorRows)} rejected row(s) will not be imported.
              </span>
            </label>
            <div className="mt-4 flex justify-end">
              <ActionButton onClick={() => runImport(0, detail.chunkCount, detail.preview!.token!)} disabled={!confirmed || busy || summary.reviewRows > 0 || importableRows === 0} data-confirm-import>
                Import {fmt(importableRows)} row(s)
              </ActionButton>
            </div>
          </Panel>
        </>
      ) : null}

      {detail && step === "importing" ? (
        <Panel title="Importing" description={`${detail.reference} · ${detail.fileName}`}>
          {progress ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">
                Part {progress.part + 1} of {progress.total}. Each part is saved completely or not at all. Keep this page open.
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round((progress.part / progress.total) * 100)}%` }} />
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-slate-300">
              <p>
                {detail.nextChunk} of {detail.chunkCount} part(s) are imported. The import stopped before finishing; nothing from the unfinished part was saved.
              </p>
              <div className="flex flex-wrap gap-2">
                {detail.token ? <ActionButton onClick={() => runImport(detail.nextChunk, detail.chunkCount, detail.token!)}>Resume import</ActionButton> : null}
                <Link href="/inventory/import/history" className="inline-flex h-9 items-center rounded-lg border border-slate-700 px-3 text-slate-100 hover:bg-slate-800">
                  Roll back from Import History
                </Link>
              </div>
            </div>
          )}
        </Panel>
      ) : null}

      {detail && step === "done" ? (
        <Panel title={`Import report · ${detail.reference}`} description={`${detail.fileName} · ${detail.status === "ROLLED_BACK" ? "rolled back" : "completed"}`}>
          <StatGrid
            stats={[
              { label: "Records processed", value: fmt(Number(resultSummary?.processedRows ?? 0)), tone: "slate" },
              { label: "Products created", value: fmt(Number(resultSummary?.productsCreated ?? 0)), tone: "emerald" },
              { label: "Products matched", value: fmt(Number(resultSummary?.productsMatched ?? 0)), tone: "sky" },
              { label: "Batches created", value: fmt(Number(resultSummary?.batchesCreated ?? 0)), note: `${fmt(Number(resultSummary?.quantityImported ?? 0))} base units of stock`, tone: "emerald" },
              { label: "Rows skipped", value: fmt(Number(resultSummary?.rowsSkipped ?? 0)), tone: "slate" },
              { label: "Rows rejected", value: fmt(Number(resultSummary?.rowsRejected ?? 0)), tone: Number(resultSummary?.rowsRejected) ? "rose" : "slate" },
              { label: "Rows with warnings", value: fmt(Number(resultSummary?.rowsWithWarnings ?? 0)), tone: "amber" },
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            {[
              ["success", "Imported rows (CSV)"],
              ["rejected", "Rejected rows to correct (CSV)"],
              ["all", "Full report (CSV)"],
            ].map(([type, label]) => (
              <a key={type} href={`/api/inventory-imports/${detail.id}/report?type=${type}`} className="inline-flex items-center gap-1 text-blue-400 hover:underline">
                <Download className="h-4 w-4" /> {label}
              </a>
            ))}
            <Link href="/inventory/import/history" className="inline-flex items-center gap-1 text-blue-400 hover:underline">
              <History className="h-4 w-4" /> Import history
            </Link>
          </div>
        </Panel>
      ) : null}

      {selectedRow ? <RowModal row={selectedRow} kind={kind} fields={kindFields} onClose={() => setSelected(null)} onDecide={decide} onSave={saveEdit} busy={busy} /> : null}
    </div>
  );
}

function ProductCardView({ title, card, tone }: { title: string; card: Card; tone: string }) {
  const rows: [string, string | undefined][] = [
    ["Name", card.name],
    ["Generic", card.genericName],
    ["Strength", card.strength],
    ["Dosage form", card.dosageForm],
    ["Category", card.category],
    ["Barcode", card.barcode],
    ["SKU", card.sku],
    ["Base unit", card.baseUnit],
    ["Packaging", card.packaging],
    ["Purchase price", card.purchasePrice !== undefined ? naira(card.purchasePrice) : undefined],
    ["Selling price", card.sellingPrice !== undefined ? naira(card.sellingPrice) : undefined],
    ["In stock", card.stock !== undefined ? fmt(card.stock) : undefined],
    ["Outlet", card.outlet],
  ];
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-xs">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-slate-100">{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function RowModal({
  row,
  kind,
  fields,
  onClose,
  onDecide,
  onSave,
  busy,
}: {
  row: Row;
  kind: Kind;
  fields: FieldInfo[];
  onClose: () => void;
  onDecide: (row: Row, decision: Decision | null) => void;
  onSave: (row: Row, values: Record<string, string>) => void;
  busy: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.key, row.values[field.key] ?? ""])));
  const candidates = row.candidates ?? (row.existing ? [row.existing] : []);
  return (
    <Modal open title={`Row ${row.row}: ${row.productName || "unnamed"}`} description={STATUS_LABEL[row.status]} onClose={onClose} wide>
      <div className="space-y-4">
        {[...row.errors, ...row.warnings].length ? (
          <div className="space-y-1 text-sm">
            {row.errors.map((message) => (
              <p key={message} className="text-rose-300">{message}</p>
            ))}
            {row.warnings.map((message) => (
              <p key={message} className="text-amber-200">{message}</p>
            ))}
          </div>
        ) : null}

        {candidates.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            <ProductCardView title="In your file" card={row.incoming} tone="border-slate-700" />
            <div className="space-y-3">
              {candidates.map((candidate) => (
                <div key={candidate.id} className="space-y-2">
                  <ProductCardView title={row.action === "match" && row.productId === candidate.id ? "Matched in PharmaERP" : "Existing in PharmaERP"} card={candidate} tone="border-sky-500/30" />
                  {row.action === "review" || (row.action === "match" && row.productId !== candidate.id) ? (
                    <ActionButton tone="secondary" disabled={busy} onClick={() => onDecide(row, { action: "match", productId: candidate.id! })}>
                      Same product: use {candidate.name}
                    </ActionButton>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {row.action === "review" && kind !== "stock" ? (
            <ActionButton tone="secondary" disabled={busy} onClick={() => onDecide(row, { action: "create" })}>
              Different product: create new
            </ActionButton>
          ) : null}
          {row.status === "skipped" && row.decision?.action === "skip" ? (
            <ActionButton tone="secondary" disabled={busy} onClick={() => onDecide(row, null)}>
              Include this row again
            </ActionButton>
          ) : (
            <ActionButton tone="danger" disabled={busy} onClick={() => onDecide(row, { action: "skip" })}>
              Skip this row
            </ActionButton>
          )}
          {row.decision && row.decision.action !== "skip" ? (
            <ActionButton tone="ghost" disabled={busy} onClick={() => onDecide(row, null)}>
              Undo my decision
            </ActionButton>
          ) : null}
        </div>

        <details className="rounded-xl border border-slate-800 p-3" open={row.status === "error"}>
          <summary className="cursor-pointer text-sm font-medium text-slate-200">Correct this row</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {fields
              .filter((field) => field.key !== "productId")
              .map((field) => (
                <Field key={field.key} label={field.label}>
                  <TextInput value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} maxLength={500} />
                </Field>
              ))}
          </div>
          <div className="mt-3 flex justify-end">
            <ActionButton disabled={busy} onClick={() => onSave(row, values)}>
              Save correction and re-check
            </ActionButton>
          </div>
        </details>
      </div>
    </Modal>
  );
}
