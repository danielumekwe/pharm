"use client";

import { AlertTriangle, Check, ChevronLeft, ChevronRight, Maximize2, Minus, Plus, RotateCw, Save } from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { StatusBadge } from "@/components/erp/status-badge";

import { call } from "./api";
import type { Confidence, FieldDef, JobDetail, ProductDecision, RecordKind, ScanRecordView } from "./types";

type Draft = { edits: Record<string, string | { confirm: true }>; product?: ProductDecision | null; notDuplicate?: boolean; kind?: RecordKind; note?: string };
type Filter = "all" | "attention" | "ready" | "approved" | "rejected" | "done";

const CONFIDENCE: Record<Confidence, { label: string; className: string; input: string }> = {
  high: { label: "High", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", input: "border-slate-700" },
  medium: { label: "Medium", className: "border-amber-500/30 bg-amber-500/10 text-amber-300", input: "border-amber-500/60" },
  low: { label: "Low — check", className: "border-rose-500/40 bg-rose-500/15 text-rose-200", input: "border-rose-500/70 bg-rose-500/5" },
  none: { label: "Not detected", className: "border-slate-600/40 bg-slate-700/20 text-slate-400", input: "border-dashed border-slate-600" },
  confirmed: { label: "Checked", className: "border-sky-500/30 bg-sky-500/10 text-sky-300", input: "border-sky-600/60" },
};

const RECORD_STATUS: Record<ScanRecordView["status"], { label: string; tone: "emerald" | "amber" | "rose" | "sky" | "slate" }> = {
  PENDING: { label: "Awaiting review", tone: "amber" },
  APPROVED: { label: "Approved", tone: "emerald" },
  REJECTED: { label: "Rejected", tone: "slate" },
  IMPORTED: { label: "Imported", tone: "emerald" },
  FAILED: { label: "Failed", tone: "rose" },
  SKIPPED: { label: "Skipped", tone: "slate" },
};

export function ReviewPanel({ detail, setDetail, busy, setBusy, setError, closed }: { detail: JobDetail; setDetail: Dispatch<SetStateAction<JobDetail>>; busy: boolean; setBusy: (value: boolean) => void; setError: (value: string | null) => void; closed: boolean }) {
  const base = `/api/document-scans/${encodeURIComponent(detail.id)}`;
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [pageOnly, setPageOnly] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [bulk, setBulk] = useState<{ field: string; value: string } | null>(null);
  const [adding, setAdding] = useState<{ kind: RecordKind; values: Record<string, string> } | null>(null);
  const [showText, setShowText] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const page = detail.pages[Math.min(pageIndex, Math.max(0, detail.pages.length - 1))];
  const selected = detail.records.find((record) => record.id === selectedId) ?? null;
  const kinds = Object.keys(detail.fields) as RecordKind[];
  const dirty = Object.keys(drafts).length;

  const visible = useMemo(
    () =>
      detail.records.filter((record) => {
        if (pageOnly && page && record.pageId !== page.id) return false;
        if (filter === "attention") return record.status === "PENDING" && record.blocked;
        if (filter === "ready") return record.status === "PENDING" && !record.blocked;
        if (filter === "approved") return record.status === "APPROVED";
        if (filter === "rejected") return record.status === "REJECTED";
        if (filter === "done") return record.status === "IMPORTED" || record.status === "FAILED" || record.status === "SKIPPED";
        return true;
      }),
    [detail.records, filter, pageOnly, page],
  );

  const apply = async (url: string, method: "POST" | "PATCH", body: unknown) => {
    setBusy(true);
    setError(null);
    setLocalError(null);
    const result = await call<JobDetail>(url, method, body);
    setBusy(false);
    if (!result.ok) {
      setLocalError(result.error);
      return false;
    }
    setDetail(result.data);
    return true;
  };

  const saveDrafts = async () => {
    if (!dirty) return true;
    const updates = Object.entries(drafts).map(([id, draft]) => ({ id, edits: draft.edits, ...(draft.product !== undefined ? { product: draft.product } : {}), ...(draft.notDuplicate !== undefined ? { notDuplicate: draft.notDuplicate } : {}), ...(draft.kind ? { kind: draft.kind } : {}), ...(draft.note !== undefined ? { note: draft.note } : {}) }));
    const ok = await apply(`${base}/records`, "PATCH", { updates });
    if (ok) setDrafts({});
    return ok;
  };

  const approve = async (allValid: boolean) => {
    if (!(await saveDrafts())) return;
    const ok = await apply(`${base}/actions`, "POST", allValid ? { action: "approve", allValid: true } : { action: "approve", ids: [...checked] });
    if (ok) setChecked(new Set());
  };

  const draftOf = (record: ScanRecordView): Draft => drafts[record.id] ?? { edits: {} };
  const updateDraft = (record: ScanRecordView, change: (draft: Draft) => Draft) => setDrafts((current) => ({ ...current, [record.id]: change(current[record.id] ?? { edits: {} }) }));

  const select = (record: ScanRecordView) => {
    setSelectedId(record.id === selectedId ? null : record.id);
    if (record.pageId) {
      const index = detail.pages.findIndex((entry) => entry.id === record.pageId);
      if (index >= 0) setPageIndex(index);
    }
  };

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const counts = {
    all: detail.records.length,
    attention: detail.records.filter((record) => record.status === "PENDING" && record.blocked).length,
    ready: detail.records.filter((record) => record.status === "PENDING" && !record.blocked).length,
    approved: detail.records.filter((record) => record.status === "APPROVED").length,
    rejected: detail.records.filter((record) => record.status === "REJECTED").length,
    done: detail.records.filter((record) => ["IMPORTED", "FAILED", "SKIPPED"].includes(record.status)).length,
  };
  const checkedRecords = detail.records.filter((record) => checked.has(record.id));
  const bulkKind = checkedRecords[0]?.kind ?? kinds[0];
  const region = selected && selected.pageId === page?.id ? selected.region : null;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <h4 className="font-semibold text-white">Check and correct</h4>
        <p className="text-sm text-slate-400">
          Compare each record with the page. Values the AI found hard to read are outlined in red: correct them, or press ✓ if the reading is right. Blank fields were not found on the page — nothing is guessed. Click a record to highlight where it is on the page.
        </p>
      </div>
      <FormError message={localError} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* ------------------------------------------------ original page */}
        <div className="space-y-2 xl:sticky xl:top-4 xl:self-start">
          {page ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button type="button" className="rounded p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40" disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)} aria-label="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm text-slate-300">
                    Page {page.number} of {detail.pages.length}
                  </span>
                  <button type="button" className="rounded p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40" disabled={pageIndex >= detail.pages.length - 1} onClick={() => setPageIndex(pageIndex + 1)} aria-label="Next page">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="rounded p-1.5 text-slate-300 hover:bg-slate-800" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Zoom out">
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center text-xs text-slate-400">{Math.round(zoom * 100)}%</span>
                  <button type="button" className="rounded p-1.5 text-slate-300 hover:bg-slate-800" onClick={() => setZoom(Math.min(4, zoom + 0.25))} aria-label="Zoom in">
                    <Plus className="h-4 w-4" />
                  </button>
                  <button type="button" className="rounded p-1.5 text-slate-300 hover:bg-slate-800" onClick={() => setZoom(1)} aria-label="Fit to width">
                    <Maximize2 className="h-4 w-4" />
                  </button>
                  <button type="button" className="rounded p-1.5 text-slate-300 hover:bg-slate-800" onClick={() => setTurn((turn + 90) % 360)} aria-label="Rotate view">
                    <RotateCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-700 bg-slate-950">
                <div className="relative origin-top-left" style={{ width: `${zoom * 100}%`, transform: turn ? `rotate(${turn}deg)` : undefined, transformOrigin: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, short-lived page image */}
                  <img src={page.imageUrl} alt={`Page ${page.number} as uploaded`} className="block w-full" />
                  {region ? <div className="pointer-events-none absolute rounded border-2 border-blue-400 bg-blue-400/15 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} /> : null}
                </div>
              </div>
              {page.status === "FAILED" ? <p className="text-xs text-rose-300">This page could not be read: {page.error} Type its records in with “Add record by hand”.</p> : null}
              {page.notes ? (
                <p className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> {page.notes}
                </p>
              ) : null}
              {page.transcription ? (
                <div>
                  <button type="button" className="text-xs text-blue-400 hover:underline" onClick={() => setShowText(!showText)}>
                    {showText ? "Hide" : "Show"} the text as read
                  </button>
                  {showText ? <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">{page.transcription}</pre> : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-400">No pages yet.</p>
          )}
        </div>

        {/* ------------------------------------------------ extracted records */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["all", "All"],
                ["attention", "Needs correction"],
                ["ready", "Ready"],
                ["approved", "Approved"],
                ["rejected", "Rejected"],
                ["done", "Imported / failed"],
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full border px-2.5 py-1 text-xs ${filter === value ? "border-blue-500/60 bg-blue-500/15 text-white" : "border-slate-700 text-slate-400 hover:text-white"}`}>
                {label} ({counts[value]})
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
              <input type="checkbox" checked={pageOnly} onChange={(event) => setPageOnly(event.target.checked)} /> This page only
            </label>
          </div>

          {!closed ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <label className="flex items-center gap-1.5 px-1 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.filter((record) => record.status === "PENDING" || record.status === "REJECTED").every((record) => checked.has(record.id))}
                  onChange={(event) => setChecked(event.target.checked ? new Set(visible.filter((record) => record.status === "PENDING" || record.status === "REJECTED").map((record) => record.id)) : new Set())}
                />
                Select shown
              </label>
              <ActionButton tone="secondary" disabled={busy || !dirty} onClick={saveDrafts}>
                <Save className="h-4 w-4" /> Save draft{dirty ? ` (${dirty})` : ""}
              </ActionButton>
              <ActionButton tone="secondary" disabled={busy || !checked.size} onClick={() => setBulk({ field: "", value: "" })}>
                Correct selected
              </ActionButton>
              {detail.permissions.approve ? (
                <>
                  <ActionButton disabled={busy || !checked.size} onClick={() => approve(false)}>
                    <Check className="h-4 w-4" /> Approve selected ({checked.size})
                  </ActionButton>
                  <ActionButton disabled={busy || counts.ready === 0} onClick={() => approve(true)}>
                    Approve all valid ({counts.ready})
                  </ActionButton>
                </>
              ) : null}
              <ActionButton tone="danger" disabled={busy || !checked.size} onClick={() => setRejecting(true)}>
                Reject selected
              </ActionButton>
              {checkedRecords.length && checkedRecords.every((record) => record.status === "REJECTED") ? (
                <ActionButton tone="ghost" disabled={busy} onClick={() => apply(`${base}/actions`, "POST", { action: "reopen", ids: [...checked] }).then((ok) => ok && setChecked(new Set()))}>
                  Put back for review
                </ActionButton>
              ) : null}
              <ActionButton tone="ghost" disabled={busy} onClick={() => setAdding({ kind: kinds[0], values: {} })}>
                <Plus className="h-4 w-4" /> Add record by hand
              </ActionButton>
            </div>
          ) : null}
          {!detail.permissions.approve && !closed ? <p className="text-xs text-slate-500">You can correct and reject records. Approval and import are done by an authorised approver (e.g. the Super Administrator).</p> : null}

          {visible.length === 0 ? <p className="rounded-lg border border-slate-800 p-6 text-center text-sm text-slate-400">{detail.records.length ? "No records match this filter." : "No records yet. When the AI has read the pages they appear here, or add records by hand."}</p> : null}

          <ul className="space-y-2">
            {visible.map((record) => {
              const draft = draftOf(record);
              const kind = draft.kind ?? record.kind;
              const defs: FieldDef[] = detail.fields[kind] ?? [];
              const open = record.id === selectedId;
              const status = RECORD_STATUS[record.status];
              const editable = record.status === "PENDING" && !closed;
              const lows = Object.values(record.fields).filter((field) => field.confidence === "low").length;
              const errors = record.issues.filter((issue) => issue.level === "error");
              const warnings = record.issues.filter((issue) => issue.level === "warning");
              return (
                <li key={record.id} className={`rounded-xl border ${open ? "border-blue-500/50 bg-slate-950" : record.blocked ? "border-rose-500/30 bg-slate-950/60" : "border-slate-800 bg-slate-950/60"}`}>
                  <div className="flex items-start gap-2 p-3">
                    {record.status === "PENDING" || record.status === "REJECTED" ? <input type="checkbox" className="mt-1" checked={checked.has(record.id)} onChange={() => toggle(record.id)} aria-label={`Select record ${record.number}`} /> : <span className="w-[13px]" />}
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => select(record)} aria-expanded={open}>
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-slate-500">#{record.number}</span>
                        <span className="truncate text-white">{record.summary || "(empty)"}</span>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <StatusBadge status={status.label} tone={status.tone} />
                        <span>{record.kindLabel}</span>
                        {record.page ? <span>page {record.page}</span> : null}
                        {record.manual ? <span>typed by hand</span> : null}
                        {record.corrected ? <span className="text-sky-300">corrected</span> : null}
                        {record.status === "PENDING" && errors.length ? <span className="text-rose-300">{errors.length} to fix</span> : null}
                        {record.status === "PENDING" && !errors.length && warnings.length ? <span className="text-amber-300">{warnings.length} to check</span> : null}
                        {lows ? <span className="text-rose-300">{lows} hard to read</span> : null}
                        {record.duplicateOf ? <span className="text-amber-300">possible duplicate ({record.duplicateOf})</span> : null}
                        {draft && drafts[record.id] ? <span className="text-blue-300">unsaved</span> : null}
                      </p>
                      {record.result ? <p className="mt-1 text-xs text-slate-300">{record.result.outcome}</p> : null}
                      {record.status === "REJECTED" && record.note ? <p className="mt-1 text-xs text-slate-500">Reason: {record.note}</p> : null}
                    </button>
                  </div>
                  {open ? (
                    <div className="space-y-3 border-t border-slate-800 p-3">
                      {kinds.length > 1 && editable ? (
                        <Field label="Record type" hint="A day's total without the items sold is a daily total; never split it into product sales.">
                          <SelectInput value={kind} onChange={(event) => updateDraft(record, (current) => ({ ...current, kind: event.target.value as RecordKind }))} options={kinds.map((value) => ({ value, label: value === "sale" ? "Sale (item sold)" : value === "daily_sales" ? "Daily sales total" : value }))} />
                        </Field>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2">
                        {defs.map((def) => {
                          const original = record.fields[def.key] ?? { value: "", confidence: "none" as Confidence };
                          const edit = draft.edits[def.key];
                          const value = typeof edit === "string" ? edit : original.value;
                          const confidence: Confidence = typeof edit === "string" || (edit && typeof edit === "object") ? (value ? "confirmed" : "none") : original.confidence;
                          const style = CONFIDENCE[confidence];
                          const fieldIssues = record.issues.filter((issue) => issue.field === def.key);
                          return (
                            <div key={def.key} className="grid gap-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                  {def.label}
                                  {def.required ? <span className="text-rose-300"> *</span> : null}
                                </span>
                                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${style.className}`}>{style.label}</span>
                              </div>
                              <div className="flex gap-1">
                                {def.key === "category" && kind === "expense" ? (
                                  <TextInput list="expense-categories" value={value} disabled={!editable} className={style.input} onChange={(event) => updateDraft(record, (current) => ({ ...current, edits: { ...current.edits, [def.key]: event.target.value } }))} />
                                ) : (
                                  <TextInput value={value} disabled={!editable} inputMode={def.type === "money" || def.type === "integer" ? "decimal" : undefined} placeholder={def.type === "date" ? "dd/mm/yyyy" : def.hint || undefined} className={style.input} onChange={(event) => updateDraft(record, (current) => ({ ...current, edits: { ...current.edits, [def.key]: event.target.value } }))} />
                                )}
                                {editable && value && (confidence === "low" || confidence === "medium") ? (
                                  <button type="button" title="The reading is right" aria-label={`Confirm ${def.label}`} className="rounded-lg border border-slate-700 px-2 text-emerald-300 hover:bg-emerald-500/10" onClick={() => updateDraft(record, (current) => ({ ...current, edits: { ...current.edits, [def.key]: { confirm: true } } }))}>
                                    <Check className="h-4 w-4" />
                                  </button>
                                ) : null}
                              </div>
                              {original.read && original.read !== value ? <span className="text-[11px] text-slate-500">Written as: “{original.read}”</span> : null}
                              {fieldIssues.map((issue) => (
                                <span key={issue.message} className={`text-[11px] ${issue.level === "error" ? "text-rose-300" : "text-amber-300"}`}>
                                  {issue.message}
                                </span>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                      <datalist id="expense-categories">
                        {detail.expenseCategories.map((category) => (
                          <option key={category} value={category} />
                        ))}
                      </datalist>

                      {kind === "inventory" && editable ? (
                        <fieldset className="space-y-1.5 rounded-lg border border-slate-800 p-3">
                          <legend className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">Product in PharmaERP</legend>
                          {record.candidates.length ? <p className="text-xs text-slate-400">Similar products already exist. Products are never merged automatically: choose one, or confirm this is a different product.</p> : <p className="text-xs text-slate-400">No similar product found at this outlet.</p>}
                          {record.candidates.map((candidate) => {
                            const current = draft.product !== undefined ? draft.product : record.decision?.product;
                            return (
                              <label key={candidate.id} className="flex items-start gap-2 text-sm text-slate-200">
                                <input type="radio" name={`product-${record.id}`} checked={current?.action === "match" && current.productId === candidate.id} onChange={() => updateDraft(record, (draftValue) => ({ ...draftValue, product: { action: "match", productId: candidate.id } }))} />
                                <span>
                                  Same as <strong>{candidate.name}</strong> {candidate.strength} {candidate.dosageForm} <span className="text-xs text-slate-500">({candidate.reason}; {candidate.stock} in stock{candidate.barcode ? `; ${candidate.barcode}` : ""})</span>
                                </span>
                              </label>
                            );
                          })}
                          {detail.stockMode !== "batches" ? (
                            <label className="flex items-center gap-2 text-sm text-slate-200">
                              <input type="radio" name={`product-${record.id}`} checked={(draft.product !== undefined ? draft.product : record.decision?.product)?.action === "create"} onChange={() => updateDraft(record, (draftValue) => ({ ...draftValue, product: { action: "create" } }))} />
                              {record.candidates.length ? "A different, new product" : "New product"}
                            </label>
                          ) : null}
                        </fieldset>
                      ) : null}

                      {record.duplicateOf && editable && !record.duplicateOf.startsWith("SUP-") ? (
                        <label className="flex items-center gap-2 text-sm text-amber-200">
                          <input type="checkbox" checked={draft.notDuplicate ?? record.decision?.notDuplicate ?? false} onChange={(event) => updateDraft(record, (current) => ({ ...current, notDuplicate: event.target.checked }))} />
                          This is not a duplicate (I checked the page)
                        </label>
                      ) : null}

                      {record.issues.filter((issue) => !issue.field).length ? (
                        <ul className="space-y-1">
                          {record.issues
                            .filter((issue) => !issue.field)
                            .map((issue) => (
                              <li key={issue.message} className={`flex gap-2 text-xs ${issue.level === "error" ? "text-rose-300" : "text-amber-300"}`}>
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {issue.message}
                              </li>
                            ))}
                        </ul>
                      ) : null}
                      {editable ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          {drafts[record.id] ? (
                            <ActionButton tone="ghost" onClick={() => setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== record.id)))}>
                              Undo changes
                            </ActionButton>
                          ) : null}
                          <ActionButton tone="secondary" disabled={busy || !drafts[record.id]} onClick={saveDrafts}>
                            <Save className="h-4 w-4" /> Save correction
                          </ActionButton>
                        </div>
                      ) : null}
                      {record.approvedBy ? <p className="text-xs text-slate-500">Approved by {record.approvedBy}{record.approvedAt ? ` on ${new Date(record.approvedAt).toLocaleString("en-NG")}` : ""}</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <Modal open={rejecting} title={`Reject ${checked.size} record(s)?`} description="Rejected records are not imported. You can put them back for review later." onClose={() => setRejecting(false)}>
        <div className="space-y-3">
          <Field label="Reason (optional)">
            <TextInput value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. crossed out on the page, duplicate entry" />
          </Field>
          <div className="flex justify-end gap-2">
            <ActionButton tone="secondary" onClick={() => setRejecting(false)}>
              Cancel
            </ActionButton>
            <ActionButton
              tone="danger"
              disabled={busy}
              onClick={async () => {
                setRejecting(false);
                if (await apply(`${base}/actions`, "POST", { action: "reject", ids: [...checked], reason })) {
                  setChecked(new Set());
                  setReason("");
                }
              }}
            >
              Reject
            </ActionButton>
          </div>
        </div>
      </Modal>

      <Modal open={bulk !== null} title={`Correct ${checked.size} record(s) at once`} description="Sets the same value on every selected record, e.g. the supplier or the date written at the top of the page." onClose={() => setBulk(null)}>
        {bulk ? (
          <div className="space-y-3">
            <Field label="Field">
              <SelectInput value={bulk.field} onChange={(event) => setBulk({ ...bulk, field: event.target.value })} options={[{ value: "", label: "Choose a field" }, ...(detail.fields[bulkKind] ?? []).map((def) => ({ value: def.key, label: def.label }))]} />
            </Field>
            <Field label="Value">
              <TextInput value={bulk.value} onChange={(event) => setBulk({ ...bulk, value: event.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <ActionButton tone="secondary" onClick={() => setBulk(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                disabled={busy || !bulk.field}
                onClick={async () => {
                  const value = bulk;
                  setBulk(null);
                  if (!(await saveDrafts())) return;
                  await apply(`${base}/records`, "PATCH", { bulk: { ids: [...checked], field: value.field, value: value.value } });
                }}
              >
                Apply to {checked.size} record(s)
              </ActionButton>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={adding !== null} title="Add a record by hand" description={page ? `It will be linked to page ${page.number}.` : undefined} onClose={() => setAdding(null)} wide>
        {adding ? (
          <div className="space-y-3">
            {kinds.length > 1 ? (
              <Field label="Record type">
                <SelectInput value={adding.kind} onChange={(event) => setAdding({ kind: event.target.value as RecordKind, values: {} })} options={kinds.map((value) => ({ value, label: value === "sale" ? "Sale (item sold)" : value === "daily_sales" ? "Daily sales total" : value }))} />
              </Field>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {(detail.fields[adding.kind] ?? []).map((def) => (
                <Field key={def.key} label={`${def.label}${def.required ? " *" : ""}`} hint={def.hint || undefined}>
                  <TextInput value={adding.values[def.key] ?? ""} placeholder={def.type === "date" ? "dd/mm/yyyy" : undefined} onChange={(event) => setAdding({ ...adding, values: { ...adding.values, [def.key]: event.target.value } })} />
                </Field>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <ActionButton tone="secondary" onClick={() => setAdding(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                disabled={busy}
                onClick={async () => {
                  const value = adding;
                  if (await apply(`${base}/records`, "POST", { kind: value.kind, pageId: page?.id, edits: value.values })) setAdding(null);
                }}
              >
                Add record
              </ActionButton>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
