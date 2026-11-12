"use client";

import { ArrowDown, ArrowUp, CheckCircle2, Crop as CropIcon, Download, ExternalLink, Loader2, RefreshCw, ScanText, Sparkles, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActionButton, Field, FormError, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { StatusBadge } from "@/components/erp/status-badge";

import { call } from "./api";
import { preparePage, uploadWithProgress, type Edit } from "./image-tools";
import { JOB_TONES } from "./job-status";
import { PageEditor } from "./page-editor";
import { ReviewPanel } from "./review-panel";
import type { JobDetail, ScanPageView } from "./types";
import { UploadPanel } from "./upload-panel";

const PAGE_STATUS: Record<ScanPageView["status"], { label: string; tone: "emerald" | "amber" | "rose" | "sky" | "slate" }> = {
  UPLOADED: { label: "Not read yet", tone: "slate" },
  QUEUED: { label: "Waiting", tone: "sky" },
  PROCESSING: { label: "Reading…", tone: "sky" },
  DONE: { label: "Read", tone: "emerald" },
  FAILED: { label: "Could not read", tone: "rose" },
};

const STEPS = ["Record type", "Upload", "AI extraction", "Review", "Approve", "Import", "Report"];

function stepOf(detail: JobDetail) {
  if (detail.status === "COMPLETED") return 6;
  if (detail.status === "IMPORTING" || detail.reconciliation.imported > 0) return 5;
  if (detail.status === "APPROVED" || detail.reconciliation.approved > 0) return 4;
  if (detail.records.length) return 3;
  if (detail.status === "PROCESSING") return 2;
  return 1;
}

export function JobWorkspace({ initial, stockModes, limits }: { initial: JobDetail; stockModes: Record<string, string>; limits: { maxPageBytes: number; maxPages: number } }) {
  const [detail, setDetail] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUpload, setShowUpload] = useState(initial.pages.length === 0);
  const [replacing, setReplacing] = useState<{ page: ScanPageView; blob: Blob } | null>(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [staged, setStaged] = useState<{ reference: string; url: string } | null>(null);
  const working = useRef(false);
  const base = `/api/document-scans/${encodeURIComponent(detail.id)}`;
  const closed = detail.status === "COMPLETED" || detail.status === "CANCELLED";

  const refresh = useCallback(async () => {
    const result = await call<JobDetail>(base, "GET");
    if (result.ok) setDetail(result.data);
    return result;
  }, [base]);

  const act = useCallback(
    async <T extends Partial<JobDetail>>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) => {
      setBusy(true);
      setError(null);
      const result = await call<T>(url, method, body);
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        await refresh();
        return null;
      }
      if (result.data && "records" in result.data && "pages" in result.data) setDetail(result.data as unknown as JobDetail);
      return result.data;
    },
    [refresh],
  );

  // While pages are being read: refresh every few seconds, and restart reading when pages wait with no reader.
  const processing = detail.status === "PROCESSING";
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(async () => {
      const result = await refresh();
      if (result.ok && result.data.needsWorker && !working.current) {
        working.current = true;
        await call(`${base}/process`, "POST");
        working.current = false;
        await refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [processing, refresh, base]);

  const startExtraction = (pageIds?: string[]) => act(`${base}/extract`, "POST", pageIds ? { pageIds } : {});

  const movePage = (index: number, by: -1 | 1) => {
    const order = detail.pages.map((page) => page.id);
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void act(`${base}/pages`, "PATCH", { order });
  };

  const beginReplace = async (page: ScanPageView) => {
    setError(null);
    try {
      const response = await fetch(page.imageUrl, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setReplacing({ page, blob: await response.blob() });
    } catch {
      setError("The page image could not be loaded. Reload the page and try again.");
    }
  };

  // Rotate / crop an uploaded page: the edited image is uploaded as a new page in the same place and the old one removed.
  const finishReplace = async (edit: Edit) => {
    if (!replacing) return;
    const { page, blob } = replacing;
    setReplacing(null);
    setBusy(true);
    try {
      const prepared = await preparePage(blob, edit);
      const form = new FormData();
      form.append("file", prepared.blob, `page-${page.number}.jpg`);
      form.append("documentId", page.documentId);
      form.append("documentName", page.documentName);
      const uploaded = await uploadWithProgress(`${base}/pages`, form, () => undefined);
      if (uploaded.status !== 201) throw new Error(String(uploaded.data.error ?? "Upload failed."));
      const removed = await call<JobDetail>(`${base}/pages/${encodeURIComponent(page.id)}`, "DELETE");
      if (!removed.ok) throw new Error(removed.error);
      const order = removed.data.pages.map((entry) => entry.id).filter((id) => id !== uploaded.data.id);
      order.splice(page.number - 1, 0, String(uploaded.data.id));
      await call(`${base}/pages`, "PATCH", { order });
      await refresh();
    } catch (problem) {
      setError((problem as Error).message || "The page could not be replaced.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setConfirmImport(false);
    const result = await act<JobDetail & { inventoryImport?: { reference: string; url: string } }>(`${base}/actions`, "POST", { action: "import" });
    if (result?.inventoryImport) setStaged(result.inventoryImport);
  };

  const r = detail.reconciliation;
  const step = stepOf(detail);
  const unread = detail.pages.filter((page) => page.status === "UPLOADED" || page.status === "FAILED");
  const reading = detail.pages.filter((page) => page.status === "QUEUED" || page.status === "PROCESSING").length;
  const canExtract = detail.settings.providerConfigured && detail.settings.aiApproved;
  const pendingImports = (detail.imports.inventory ?? []).filter((link) => link.status === "DRAFT" || link.status === "PREVIEWED" || link.status === "IN_PROGRESS");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`AI Document Scanner · ${detail.reference}`}
        title={detail.title}
        description={`${detail.categoryLabel} · ${detail.outletName}${detail.stockMode ? ` · ${stockModes[detail.stockMode]}` : ""} · started by ${detail.createdBy} on ${new Date(detail.createdAt).toLocaleString("en-NG")}`}
        actions={
          <>
            <StatusBadge status={detail.statusLabel} tone={JOB_TONES[detail.status]} />
            <a href={`${base}/report`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800">
              <Download className="h-4 w-4" /> Report
            </a>
            <Link href="/data-migration/scanner/history" className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-slate-300 hover:bg-slate-800">
              All jobs
            </Link>
            {!closed ? (
              <ActionButton tone="ghost" onClick={() => setCancelling(true)}>
                Cancel job
              </ActionButton>
            ) : null}
          </>
        }
      />

      <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${index < step ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : index === step ? "border-blue-500/50 bg-blue-500/10 text-blue-200" : "border-slate-800 text-slate-500"}`} aria-current={index === step ? "step" : undefined}>
            {index < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="font-semibold">{index + 1}</span>}
            {label}
          </li>
        ))}
      </ol>

      {detail.message ? <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{detail.message}</p> : null}
      <FormError message={error} />

      {/* ---------------------------------------------------------------- pages */}
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-white">Pages ({detail.pages.length})</h4>
            <p className="text-sm text-slate-400">
              {detail.documents.length} document(s). Keep the pages in the order of the book: entries that continue onto the next page are read in order.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!closed ? (
              <ActionButton tone="secondary" onClick={() => setShowUpload((value) => !value)}>
                {showUpload ? "Hide upload" : "Add pages"}
              </ActionButton>
            ) : null}
            {!closed && unread.length ? (
              <ActionButton disabled={busy || !canExtract || !detail.billing.sufficient} onClick={() => startExtraction()} title={canExtract ? undefined : "AI reading is not available"}>
                <Sparkles className="h-4 w-4" /> Start AI extraction ({unread.length} page{unread.length === 1 ? "" : "s"})
              </ActionButton>
            ) : null}
          </div>
        </div>
        {!canExtract && !closed ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {detail.settings.providerConfigured ? "AI reading has not been approved for your pharmacy yet. A Super Administrator can approve it in the Data Import Centre." : `AI reading is not set up on this server (${detail.settings.providerProblem}).`} You can still type records in by hand below.
          </p>
        ) : null}
        {!closed && unread.length && canExtract ? (
          <div className={`flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${detail.billing.sufficient ? "border-slate-700 bg-slate-950/50 text-slate-300" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`} data-scan-estimate>
            <div>
              <p>
                <span className="font-medium text-white">Estimated cost:</span> {detail.billing.pages} page(s) ×{" "}
                {detail.billing.prices.standard === detail.billing.prices.handwritten ? `${detail.billing.prices.standard} coins` : `${Math.min(detail.billing.prices.standard, detail.billing.prices.additional)}–${detail.billing.prices.handwritten} coins (handwritten pages cost more)`}
                {" = "}
                {detail.billing.minimum === detail.billing.reserve ? `${detail.billing.reserve.toLocaleString("en-NG")} coins` : `${detail.billing.minimum.toLocaleString("en-NG")}–${detail.billing.reserve.toLocaleString("en-NG")} coins`}.
                {" "}Available: <span className="font-medium text-white">{detail.billing.available.toLocaleString("en-NG")}</span> coins.
              </p>
              <p className="mt-0.5 text-xs opacity-80">
                {detail.billing.sufficient
                  ? `${detail.billing.reserve.toLocaleString("en-NG")} coins are held while the pages are read; each page is charged when read, pages that cannot be read are free, and the rest is returned.`
                  : "You do not have enough AI coins to process these documents. Please purchase additional coins."}
              </p>
            </div>
            {!detail.billing.sufficient ? (
              detail.billing.canBuy ? (
                <Link href="/ai-wallet?tab=buy" className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-medium text-[#fff] hover:bg-blue-700">Buy coins</Link>
              ) : (
                <span className="text-xs">Ask your Pharmacy Super Admin to buy coins{detail.billing.canView ? <> (<Link href="/ai-wallet" className="underline">AI Wallet</Link>)</> : null}.</span>
              )
            ) : null}
          </div>
        ) : null}
        {reading ? (
          <div className="space-y-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">
            <p className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> AI is reading {reading} page(s). You can leave this screen: reading continues, and you can come back to the job at any time.
            </p>
            <div className="h-1.5 overflow-hidden rounded bg-slate-800">
              <div className="h-full bg-sky-400 transition-all" style={{ width: `${Math.round((r.pagesProcessed / Math.max(1, detail.pages.length)) * 100)}%` }} />
            </div>
          </div>
        ) : null}

        {showUpload && !closed ? <UploadPanel jobId={detail.id} remaining={limits.maxPages - detail.pages.length} maxPageBytes={limits.maxPageBytes} disabled={busy || detail.status === "IMPORTING"} onUploaded={async () => void (await refresh())} /> : null}

        {detail.pages.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {detail.pages.map((page, index) => {
              const status = PAGE_STATUS[page.status];
              const busyPage = page.status === "QUEUED" || page.status === "PROCESSING";
              return (
                <li key={page.id} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, short-lived page image */}
                  <img src={page.imageUrl} alt={`Page ${page.number}`} loading="lazy" className="h-24 w-20 shrink-0 rounded-md border border-slate-700 bg-slate-900 object-cover" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm text-white">Page {page.number}</p>
                    <p className="truncate text-xs text-slate-500">{page.documentName}</p>
                    <StatusBadge status={status.label} tone={status.tone} />
                    {page.status === "DONE" ? <p className="text-xs text-slate-400">{page.recordCount} record(s)</p> : null}
                    {page.error ? <p className="text-xs text-rose-300">{page.error}</p> : null}
                    {!closed ? (
                      <div className="flex flex-wrap gap-1 pt-1">
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40" onClick={() => movePage(index, -1)} disabled={busy || index === 0} aria-label={`Move page ${page.number} up`}>
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40" onClick={() => movePage(index, 1)} disabled={busy || index === detail.pages.length - 1} aria-label={`Move page ${page.number} down`}>
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40" onClick={() => beginReplace(page)} disabled={busy || busyPage} aria-label={`Rotate or crop page ${page.number}`} title="Rotate or crop (replaces the page)">
                          <CropIcon className="h-4 w-4" />
                        </button>
                        {page.status === "DONE" || page.status === "FAILED" ? (
                          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40" onClick={() => act(`${base}/pages/${encodeURIComponent(page.id)}`, "POST")} disabled={busy || !canExtract} aria-label={`Reprocess page ${page.number}`} title="Read this page again">
                            <RefreshCw className="h-4 w-4" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-200 disabled:opacity-40"
                          onClick={() => window.confirm(`Remove page ${page.number}${page.recordCount ? ` and its ${page.recordCount} unapproved record(s)` : ""}?`) && act(`${base}/pages/${encodeURIComponent(page.id)}`, "DELETE")}
                          disabled={busy || busyPage}
                          aria-label={`Remove page ${page.number}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- review */}
      {detail.records.length || detail.pages.some((page) => page.status === "DONE" || page.status === "FAILED") || (!canExtract && detail.pages.length) ? (
        <ReviewPanel detail={detail} setDetail={setDetail} busy={busy} setBusy={setBusy} setError={setError} closed={closed} />
      ) : null}

      {/* ---------------------------------------------------------------- reconciliation and import */}
      {detail.records.length ? (
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div>
            <h4 className="font-semibold text-white">Reconciliation summary</h4>
            <p className="text-sm text-slate-400">Check these numbers before importing. Only approved records are imported; everything else stays here.</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Documents uploaded", r.documents],
              ["Pages processed", `${r.pagesProcessed} / ${r.pages}`],
              ["Records extracted", r.extracted],
              ["Validated", r.validated],
              ["Need correction", r.needCorrection],
              ["Possible duplicates", r.duplicates],
              ["Rejected", r.rejected],
              ["Ready for import", r.readyToImport],
              ["Imported", r.imported],
              ["Failed", r.failed],
              ["Skipped", r.skipped],
              ["Awaiting review", r.pending],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="mt-1 text-lg font-semibold text-white">{value}</dd>
              </div>
            ))}
          </dl>
          {pendingImports.map((link) => (
            <p key={link.importId} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
              {link.recordIds.length} record(s) are staged in inventory import {link.reference}. Review the preview there and confirm it to add the products and stock.
              <Link href={`/inventory/import?id=${encodeURIComponent(link.importId)}`} className="inline-flex items-center gap-1 font-medium text-white underline">
                Open import {link.reference} <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </p>
          ))}
          {!closed ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-400">
                {detail.permissions.approve
                  ? r.readyToImport
                    ? `${r.readyToImport} approved record(s) are ready.${detail.category === "inventory" ? " They will open in Bulk Import for a final preview before any stock is added." : ""}`
                    : "Approve records above to import them."
                  : "An authorised approver must approve and import these records."}
              </p>
              {detail.permissions.approve ? (
                <ActionButton disabled={busy || !r.readyToImport || reading > 0} onClick={() => setConfirmImport(true)}>
                  <ScanText className="h-4 w-4" /> Import {r.readyToImport} approved record(s)
                </ActionButton>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <Modal open={confirmImport} title="Import approved records?" onClose={() => setConfirmImport(false)}>
        <div className="space-y-3 text-sm text-slate-300">
          <p>
            {r.readyToImport} approved record(s) from {detail.reference} will be sent to{" "}
            {detail.category === "inventory"
              ? "Bulk Import as a new import. You will see its preview (matching products, new products, stock per batch) and confirm it there; stock enters only through the stock ledger."
              : detail.category === "sales"
                ? "sales history as migrated historical sales on their original dates. No stock is deducted, no payment is recorded and no customer is contacted."
                : detail.category === "expenses"
                  ? "Finance as submitted expenses. They still go through expense approval; no payment is made."
                  : "Contacts as new suppliers awaiting PCN verification. Existing suppliers are not changed."}
          </p>
          <p>{r.needCorrection + r.pending > 0 ? `${r.pending} record(s) still awaiting review stay in this job and can be imported later.` : "Every record has been reviewed."}</p>
          <div className="flex justify-end gap-2">
            <ActionButton tone="secondary" onClick={() => setConfirmImport(false)}>
              Cancel
            </ActionButton>
            <ActionButton disabled={busy} onClick={doImport}>
              Import now
            </ActionButton>
          </div>
        </div>
      </Modal>

      <Modal open={staged !== null} title="Records staged for import" onClose={() => setStaged(null)}>
        <div className="space-y-3 text-sm text-slate-300">
          <p>The approved records are now import {staged?.reference}. Open it to see the preview and confirm the import of products and opening stock.</p>
          <div className="flex justify-end gap-2">
            <ActionButton tone="secondary" onClick={() => setStaged(null)}>
              Later
            </ActionButton>
            <Link href={staged?.url ?? "/inventory/import"} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-[#fff] hover:bg-blue-700">
              Open import {staged?.reference} <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </Modal>

      <Modal open={cancelling} title={`Cancel ${detail.reference}?`} description="Uploaded pages and readings are kept for reference; nothing is imported." onClose={() => setCancelling(false)}>
        <div className="space-y-3">
          <Field label="Reason (optional)">
            <TextInput value={cancelReason} maxLength={300} onChange={(event) => setCancelReason(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <ActionButton tone="secondary" onClick={() => setCancelling(false)}>
              Keep working
            </ActionButton>
            <ActionButton
              tone="danger"
              disabled={busy}
              onClick={async () => {
                setCancelling(false);
                await act(`${base}/actions`, "POST", { action: "cancel", reason: cancelReason });
              }}
            >
              <XCircle className="h-4 w-4" /> Cancel job
            </ActionButton>
          </div>
        </div>
      </Modal>

      <PageEditor source={replacing?.blob ?? null} title={`Rotate or crop page ${replacing?.page.number ?? ""}`} onCancel={() => setReplacing(null)} onSave={finishReplace} />
    </div>
  );
}
