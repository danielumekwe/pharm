// AI Document Scanner (Data Import Centre → AI Document Scanner).
//
// Flow: create a scanning job (record type, outlet) → add page images (photos, scans, PDF pages) → start
// extraction (pages are queued and read one at a time by the configured AI provider, outside any request
// transaction) → proofread: correct, confirm, approve or reject each record → import the approved records
// through the existing workflows → report.
//
// Rules:
// - No AI-extracted record reaches live records without a person's approval (documents.approve). Records
//   with unresolved problems (missing or hard-to-read values, possible duplicates, product decisions)
//   cannot be approved.
// - Approved records go through the existing workflows only: products and stock become an ordinary
//   inventory import (preview, matching, stock ledger, rollback); expenses enter the expense approval
//   workflow; suppliers are onboarded as unverified suppliers; historical sales are recorded on their
//   original dates as migrated records that move no stock, take no payment and send no messages.
// - Page images and readings are kept when processing fails; a page can be retried or typed in by hand.
// - Everything is limited to the signed-in pharmacy (queries filter on tenant_id, plus Row Level Security),
//   and outlet staff see only their outlets' jobs.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { outlets, products } from "@/lib/data";
import { AUTH_SECRET } from "@/lib/auth-secret";
import { runSql } from "@/lib/db/database";
import { documentStore } from "@/lib/erp/document-storage";
import { newId } from "@/lib/erp/ids";
import { nameSimilarity, normaliseName, strengthsConflict, toCsv, type FieldKey, type ImportKind } from "@/lib/erp/import-format";
import { createImportFromRows, importOutcome, type Decision } from "@/lib/erp/inventory-import";
import { assertCan, assertOutletAccess, createExpense, createSupplier, DomainError, outletName, recordAudit, recordMigratedSale } from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";
import { currentTenantId } from "@/lib/saas/tenant";
import {
  applyCorrections,
  CATEGORY_KINDS,
  CATEGORY_LABELS,
  checkRecord,
  cleanRegion,
  EXPENSE_CATEGORIES,
  fingerprint,
  hasErrors,
  KIND_FIELDS,
  KIND_LABELS,
  normaliseFields,
  paymentMethodOf,
  RECORD_KINDS,
  SCAN_CATEGORIES,
  type Fields,
  type Issue,
  type RecordKind,
  type ScanCategory,
} from "@/lib/scanner/fields";
import { providerStatus, type PageExtraction } from "@/lib/scanner/providers";

// ---------------------------------------------------------------- limits

/** One page image per request (hosting platforms cap request bodies at about 4.5 MB). */
export const MAX_PAGE_BYTES = 4 * 1024 * 1024;
export const MAX_ORIGINAL_BYTES = 4 * 1024 * 1024;
export const MAX_PAGES_PER_JOB = 60;
const MAX_DIMENSION = 8000;
const MIN_DIMENSION = 200;
/** Attempts per page before it is marked failed (rate limits and outages are retried with back-off). */
export const MAX_ATTEMPTS = 3;
const LEASE_MINUTES = 5;
const IMAGE_LINK_SECONDS = 10 * 60;

export type JobStatus = "UPLOADED" | "PROCESSING" | "EXTRACTED" | "AWAITING_REVIEW" | "PARTIALLY_APPROVED" | "APPROVED" | "IMPORTING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type PageStatus = "UPLOADED" | "QUEUED" | "PROCESSING" | "DONE" | "FAILED";
export type RecordStatus = "PENDING" | "APPROVED" | "REJECTED" | "IMPORTED" | "FAILED" | "SKIPPED";
export type StockMode = "catalogue" | "opening" | "batches";

export const STATUS_LABELS: Record<JobStatus, string> = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing",
  EXTRACTED: "Extraction completed",
  AWAITING_REVIEW: "Awaiting review",
  PARTIALLY_APPROVED: "Partially approved",
  APPROVED: "Approved",
  IMPORTING: "Importing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const STOCK_MODE_LABELS: Record<StockMode, string> = {
  catalogue: "Product catalogue information only (no stock)",
  opening: "Opening stock (create missing products and add their stock)",
  batches: "Existing batch stock records (stock for products already in PharmaERP)",
};
const STOCK_MODE_KIND: Record<StockMode, ImportKind> = { catalogue: "catalogue", opening: "both", batches: "stock" };

type JobOptions = { stockMode?: StockMode; note?: string };
type DocumentEntry = { id: string; name: string; type: "image" | "pdf"; size: number; pages: number; storedName?: string; addedAt: string; addedBy: string };
type InventoryLink = { importId: string; reference: string; recordIds: string[]; status: string; stagedAt: string; stagedBy: string };
type Imports = { inventory?: InventoryLink[] };
type ReportLine = { recordId: string; seq: number; kind: RecordKind; status: RecordStatus; summary: string; outcome: string; reference?: string; page?: number; document?: string };
type JobReport = { generatedAt: string; approvedBy: string; lines: ReportLine[] };

type Job = {
  id: string;
  reference: string;
  category: ScanCategory;
  status: JobStatus;
  title: string;
  outletId: string | null;
  options: JobOptions;
  documents: DocumentEntry[];
  provider: string | null;
  imports: Imports;
  report: JobReport | null;
  message: string | null;
  createdById: string;
  createdByName: string;
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type Page = {
  id: string;
  jobId: string;
  documentId: string;
  position: number;
  storedName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  status: PageStatus;
  attempts: number;
  leaseUntil: string | null;
  nextAttemptAt: string | null;
  error: string | null;
  extraction: { type: string; readable: boolean; notes: string; transcription: string; provider: string; model: string; records: number } | null;
  processedAt: string | null;
};

type RecordDecision = { product?: Decision; notDuplicate?: boolean };
type ScanRecord = {
  id: string;
  jobId: string;
  pageId: string | null;
  seq: number;
  kind: RecordKind;
  status: RecordStatus;
  fields: Fields;
  region: { x: number; y: number; width: number; height: number } | null;
  corrected: boolean;
  manual: boolean;
  decision: RecordDecision | null;
  fingerprint: string | null;
  note: string | null;
  result: { outcome: string; reference?: string; importId?: string; row?: number } | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

// ---------------------------------------------------------------- persistence

type DbRow = Record<string, unknown>;
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null);
const json = <T>(value: unknown, fallback: T): T => (value === null || value === undefined ? fallback : typeof value === "string" ? (JSON.parse(value) as T) : (value as T));

function jobFromDb(row: DbRow): Job {
  return {
    id: String(row.id),
    reference: String(row.reference),
    category: row.category as ScanCategory,
    status: row.status as JobStatus,
    title: String(row.title),
    outletId: (row.outlet_id as string | null) ?? null,
    options: json<JobOptions>(row.options, {}),
    documents: json<DocumentEntry[]>(row.documents, []),
    provider: (row.provider as string | null) ?? null,
    imports: json<Imports>(row.imports, {}),
    report: json<JobReport | null>(row.report, null),
    message: (row.message as string | null) ?? null,
    createdById: String(row.created_by_id),
    createdByName: String(row.created_by_name),
    approvedById: (row.approved_by_id as string | null) ?? null,
    approvedByName: (row.approved_by_name as string | null) ?? null,
    approvedAt: iso(row.approved_at),
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    completedAt: iso(row.completed_at),
  };
}

function pageFromDb(row: DbRow): Page {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    documentId: String(row.document_id),
    position: Number(row.position),
    storedName: String(row.stored_name),
    mimeType: String(row.mime_type),
    size: Number(row.size),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    sha256: String(row.sha256),
    status: row.status as PageStatus,
    attempts: Number(row.attempts),
    leaseUntil: iso(row.lease_until),
    nextAttemptAt: iso(row.next_attempt_at),
    error: (row.error as string | null) ?? null,
    extraction: json<Page["extraction"]>(row.extraction, null),
    processedAt: iso(row.processed_at),
  };
}

function recordFromDb(row: DbRow): ScanRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    pageId: (row.page_id as string | null) ?? null,
    seq: Number(row.seq),
    kind: row.kind as RecordKind,
    status: row.status as RecordStatus,
    fields: json<Fields>(row.fields, {}),
    region: json<ScanRecord["region"]>(row.region, null),
    corrected: Boolean(row.corrected),
    manual: Boolean(row.manual),
    decision: json<RecordDecision | null>(row.decision, null),
    fingerprint: (row.fingerprint as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    result: json<ScanRecord["result"]>(row.result, null),
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: iso(row.approved_at),
  };
}

const JSON_COLUMNS = new Set(["options", "documents", "imports", "report", "fields", "region", "decision", "result", "extraction"]);
const NOW = Symbol("now");

async function update(table: "document_scan_jobs" | "document_scan_pages" | "document_scan_records", id: string, patch: Record<string, unknown>) {
  const params: unknown[] = [id, currentTenantId()];
  const sets = Object.entries(patch).map(([key, value]) => {
    if (value === NOW) return `${key} = now()`;
    params.push(JSON_COLUMNS.has(key) && value !== null ? JSON.stringify(value) : value);
    return `${key} = $${params.length}${JSON_COLUMNS.has(key) ? "::jsonb" : ""}`;
  });
  if (table !== "document_scan_pages") sets.push("updated_at = now()");
  await runSql(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $2`, params);
}

function visibleTo(actor: Actor, job: Pick<Job, "outletId" | "createdById">) {
  if (!isOutletScoped(actor.role)) return true;
  return job.createdById === actor.id || (job.outletId !== null && actor.outletIds.includes(job.outletId));
}

async function loadJob(actor: Actor, id: string, lock = false) {
  const [row] = await runSql<DbRow>(`SELECT * FROM document_scan_jobs WHERE id = $1 AND tenant_id = $2${lock ? " FOR UPDATE" : ""}`, [id, currentTenantId()]);
  const job = row ? jobFromDb(row) : null;
  if (!job || !visibleTo(actor, job)) throw new DomainError("Scanning job not found.", 404);
  return job;
}

async function loadPages(jobId: string) {
  const rows = await runSql<DbRow>(`SELECT * FROM document_scan_pages WHERE job_id = $1 AND tenant_id = $2 ORDER BY position, created_at`, [jobId, currentTenantId()]);
  return rows.map(pageFromDb);
}

async function loadRecords(jobId: string) {
  const rows = await runSql<DbRow>(`SELECT * FROM document_scan_records WHERE job_id = $1 AND tenant_id = $2 ORDER BY seq`, [jobId, currentTenantId()]);
  return rows.map(recordFromDb);
}

function assertScanner(actor: Actor) {
  if (!can(actor, "documents.scan") && !can(actor, "documents.approve")) assertCan(actor, "documents.scan");
  if (actor.support) throw new DomainError("Support sessions are read-only.", 403);
}

function assertApprover(actor: Actor) {
  assertCan(actor, "documents.approve");
  if (actor.support) throw new DomainError("Support sessions are read-only.", 403);
}

const CLOSED: JobStatus[] = ["CANCELLED", "COMPLETED"];
function assertOpen(job: Job) {
  if (CLOSED.includes(job.status)) throw new DomainError(`Scanning job ${job.reference} is ${STATUS_LABELS[job.status].toLowerCase()}.`, 409);
}

// ---------------------------------------------------------------- AI consent (per pharmacy)

export function scannerSettings(actor: Actor) {
  const settings = getStore().settings.documentScanner;
  const provider = providerStatus();
  return {
    provider: provider.provider,
    model: provider.model,
    providerConfigured: provider.configured,
    providerProblem: provider.problem ?? null,
    aiApproved: settings?.aiApproved === true,
    changedBy: settings?.changedBy ?? null,
    changedAt: settings?.changedAt ?? null,
    canChange: can(actor, "settings.manage"),
  };
}

/** Super Administrator's approval for sending this pharmacy's page images to the configured AI provider. */
export function setAiApproval(actor: Actor, approved: boolean) {
  assertCan(actor, "settings.manage");
  if (actor.support) throw new DomainError("Support sessions are read-only.", 403);
  const provider = providerStatus();
  getStore().settings.documentScanner = { aiApproved: approved, changedBy: actor.name, changedAt: new Date().toISOString() };
  recordAudit(actor, {
    action: "documents.ai-approval",
    entity: "Settings",
    entityId: "documentScanner",
    summary: approved ? `Approved sending scanned paper records to the AI provider (${provider.provider ?? "not configured"}${provider.model ? `, ${provider.model}` : ""}) for reading` : "Withdrew approval for sending scanned paper records to the AI provider",
    severity: "warning",
  });
  return scannerSettings(actor);
}

// ---------------------------------------------------------------- jobs

export async function listJobs(actor: Actor) {
  assertScanner(actor);
  const rows = await runSql<DbRow>(
    `SELECT j.*,
            (SELECT count(*) FROM document_scan_pages p WHERE p.job_id = j.id AND p.tenant_id = j.tenant_id) AS page_count,
            (SELECT count(*) FROM document_scan_records r WHERE r.job_id = j.id AND r.tenant_id = j.tenant_id) AS record_count,
            (SELECT count(*) FROM document_scan_records r WHERE r.job_id = j.id AND r.tenant_id = j.tenant_id AND r.status IN ('APPROVED', 'IMPORTED')) AS approved_count,
            (SELECT count(*) FROM document_scan_records r WHERE r.job_id = j.id AND r.tenant_id = j.tenant_id AND r.status = 'IMPORTED') AS imported_count
       FROM document_scan_jobs j WHERE j.tenant_id = $1 ORDER BY j.created_at DESC LIMIT 300`,
    [currentTenantId()],
  );
  return rows
    .map((row) => ({ job: jobFromDb(row), pages: Number(row.page_count), records: Number(row.record_count), approved: Number(row.approved_count), imported: Number(row.imported_count) }))
    .filter(({ job }) => visibleTo(actor, job))
    .map(({ job, ...counts }) => ({ ...summaryOf(job), ...counts }));
}

function summaryOf(job: Job) {
  return {
    id: job.id,
    reference: job.reference,
    title: job.title,
    category: job.category,
    categoryLabel: CATEGORY_LABELS[job.category],
    status: job.status,
    statusLabel: STATUS_LABELS[job.status],
    outletId: job.outletId,
    outletName: job.outletId ? outletName(job.outletId) : "All outlets",
    stockMode: job.options.stockMode ?? null,
    documents: job.documents.map(({ id, name, type, size, pages, addedAt, addedBy }) => ({ id, name, type, size, pages, addedAt, addedBy, original: Boolean(job.documents.find((doc) => doc.id === id)?.storedName) })),
    createdBy: job.createdByName,
    createdAt: job.createdAt,
    approvedBy: job.approvedByName,
    approvedAt: job.approvedAt,
    completedAt: job.completedAt,
    message: job.message,
    tenantName: getStore().settings.businessName || null,
  };
}

export async function createJob(actor: Actor, input: { category?: unknown; title?: unknown; outletId?: unknown; stockMode?: unknown; note?: unknown }) {
  assertScanner(actor);
  if (!SCAN_CATEGORIES.includes(input.category as ScanCategory)) throw new DomainError("Choose what kind of records you are scanning.");
  const category = input.category as ScanCategory;
  // Outlet staff scan for their active outlet only; the outlet never comes from an unchecked browser value.
  let outletId: string | null = typeof input.outletId === "string" && input.outletId ? input.outletId : null;
  if (isOutletScoped(actor.role)) outletId = actor.outletId ?? null;
  if (category !== "suppliers" && !outletId) throw new DomainError("Choose the outlet these records belong to.");
  if (outletId) {
    const outlet = outlets.find((row) => row.id === outletId);
    if (!outlet) throw new DomainError("The outlet is not one of this pharmacy's outlets.", 404);
    assertOutletAccess(actor, outlet.id);
    if (category === "sales" && outlet.type === "WAREHOUSE") throw new DomainError("Warehouses have no sales: choose a retail outlet.");
  }
  const options: JobOptions = {};
  if (category === "inventory") {
    if (!["catalogue", "opening", "batches"].includes(input.stockMode as string)) throw new DomainError("Choose what the quantities on these records mean: catalogue only, opening stock, or existing batch stock.");
    options.stockMode = input.stockMode as StockMode;
  }
  if (typeof input.note === "string" && input.note.trim()) options.note = input.note.trim().slice(0, 500);
  const title = (typeof input.title === "string" ? input.title.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "").slice(0, 120) || `${CATEGORY_LABELS[category]} — ${new Date().toISOString().slice(0, 10)}`;
  const id = newId("scan", randomUUID().replace(/-/g, "").slice(0, 16));
  const reference = `SCN-${String(nextNumber("documentScan")).padStart(5, "0")}`;
  await runSql(
    `INSERT INTO document_scan_jobs (id, tenant_id, reference, category, status, title, outlet_id, options, created_by_id, created_by_name)
     VALUES ($1, $2, $3, $4, 'UPLOADED', $5, $6, $7::jsonb, $8, $9)`,
    [id, currentTenantId(), reference, category, title, outletId, JSON.stringify(options), actor.id, actor.name],
  );
  recordAudit(actor, { action: "documents.scan.create", entity: "DocumentScan", entityId: reference, summary: `Started scanning job ${reference}: ${CATEGORY_LABELS[category].toLowerCase()}${options.stockMode ? ` (${STOCK_MODE_LABELS[options.stockMode].toLowerCase()})` : ""}`, outletId });
  return jobDetail(actor, id);
}

// ---------------------------------------------------------------- uploads

type ImageInfo = { mimeType: "image/jpeg" | "image/png"; width: number; height: number };

/** Reads the type and size of an image from its own bytes (the file name and browser-supplied type are not trusted). */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
    return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      // Start-of-frame markers hold the dimensions (C4, C8 and CC are other segment types).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mimeType: "image/jpeg", height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

function cleanName(name: unknown, fallback: string) {
  const text = typeof name === "string" ? name.split(/[\\/]/).pop() ?? "" : "";
  return text.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || fallback;
}

/** Adds one page image to a job. PDFs are turned into page images on the device before upload. */
export async function addPage(actor: Actor, jobId: string, input: { bytes: Uint8Array; documentId?: string; documentName?: string; documentType?: string; documentPages?: number }) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  if (job.status === "IMPORTING") throw new DomainError("Pages cannot be added while records are being imported.", 409);
  if (input.bytes.length === 0) throw new DomainError("The image is empty.");
  if (input.bytes.length > MAX_PAGE_BYTES) throw new DomainError(`Each page image must be ${MAX_PAGE_BYTES / 1024 / 1024} MB or smaller.`, 413);
  const info = inspectImage(input.bytes);
  if (!info) throw new DomainError("Only JPEG and PNG images can be added (PDF pages are converted on your device). This file is not a valid image.", 415);
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) throw new DomainError(`The image is too large (${info.width}×${info.height}). Use at most ${MAX_DIMENSION} pixels per side.`, 413);
  if (info.width < MIN_DIMENSION || info.height < MIN_DIMENSION) throw new DomainError(`The image is too small to read (${info.width}×${info.height}). Take the photo closer to the page.`);
  const pages = await loadPages(job.id);
  if (pages.length >= MAX_PAGES_PER_JOB) throw new DomainError(`A scanning job holds at most ${MAX_PAGES_PER_JOB} pages. Start another job for the rest.`);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const duplicate = pages.find((page) => page.sha256 === sha256);
  if (duplicate) throw new DomainError(`This image is already page ${pages.indexOf(duplicate) + 1} of this job.`, 409);

  const documentId = typeof input.documentId === "string" && /^[a-z0-9-]{6,64}$/i.test(input.documentId) ? input.documentId : randomUUID();
  const type: DocumentEntry["type"] = input.documentType === "pdf" ? "pdf" : "image";
  const documents = [...job.documents];
  let entry = documents.find((doc) => doc.id === documentId);
  if (!entry) {
    entry = { id: documentId, name: cleanName(input.documentName, `Page ${pages.length + 1}`), type, size: 0, pages: 0, addedAt: new Date().toISOString(), addedBy: actor.name };
    documents.push(entry);
  }
  entry.pages += 1;
  if (type === "image") entry.size += input.bytes.length;
  const id = newId("scp", randomUUID().replace(/-/g, "").slice(0, 16));
  const storedName = `scan-${job.id}-${id}.${info.mimeType === "image/png" ? "png" : "jpg"}`;
  await (await documentStore()).put(storedName, input.bytes, info.mimeType);
  const position = (pages.at(-1)?.position ?? 0) + 1;
  await runSql(
    `INSERT INTO document_scan_pages (id, tenant_id, job_id, document_id, position, stored_name, mime_type, size, width, height, sha256, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'UPLOADED')`,
    [id, currentTenantId(), job.id, documentId, position, storedName, info.mimeType, input.bytes.length, info.width, info.height, sha256],
  );
  await update("document_scan_jobs", job.id, { documents });
  await settleStatus(job.id);
  recordAudit(actor, { action: "documents.scan.upload", entity: "DocumentScan", entityId: job.reference, summary: `Added page ${pages.length + 1} (${entry.name}, ${Math.round(input.bytes.length / 1024)} KB) to ${job.reference}`, outletId: job.outletId });
  return { id, position, documentId, width: info.width, height: info.height };
}

/** Keeps the original PDF as uploaded, next to the page images made from it. */
export async function addOriginal(actor: Actor, jobId: string, input: { bytes: Uint8Array; documentId: string; documentName?: string }) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  if (input.bytes.length > MAX_ORIGINAL_BYTES) throw new DomainError(`Original PDFs up to ${MAX_ORIGINAL_BYTES / 1024 / 1024} MB are kept; larger files keep their page images only.`, 413);
  if (String.fromCharCode(...input.bytes.slice(0, 5)) !== "%PDF-") throw new DomainError("This file is not a PDF document.", 415);
  if (!/^[a-z0-9-]{6,64}$/i.test(input.documentId)) throw new DomainError("Unknown document.");
  const documents = [...job.documents];
  let entry = documents.find((doc) => doc.id === input.documentId);
  if (!entry) {
    entry = { id: input.documentId, name: cleanName(input.documentName, "Document.pdf"), type: "pdf", size: 0, pages: 0, addedAt: new Date().toISOString(), addedBy: actor.name };
    documents.push(entry);
  }
  if (entry.storedName) throw new DomainError("The original of this document is already stored.", 409);
  entry.storedName = `scan-${job.id}-${input.documentId}.pdf`;
  entry.size = input.bytes.length;
  await (await documentStore()).put(entry.storedName, input.bytes, "application/pdf");
  await update("document_scan_jobs", job.id, { documents });
  recordAudit(actor, { action: "documents.scan.upload", entity: "DocumentScan", entityId: job.reference, summary: `Stored original PDF ${entry.name} (${Math.round(input.bytes.length / 1024)} KB) in ${job.reference}`, outletId: job.outletId });
  return { id: entry.id };
}

export async function removePage(actor: Actor, jobId: string, pageId: string) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const page = (await loadPages(job.id)).find((row) => row.id === pageId);
  if (!page) throw new DomainError("Page not found.", 404);
  if (page.status === "PROCESSING" || page.status === "QUEUED") throw new DomainError("This page is being read. Wait until it is finished.", 409);
  const records = (await loadRecords(job.id)).filter((record) => record.pageId === page.id);
  if (records.some((record) => record.status !== "PENDING" && record.status !== "REJECTED")) throw new DomainError("Records from this page have already been approved or imported, so the page is kept.", 409);
  await runSql(`DELETE FROM document_scan_records WHERE page_id = $1 AND tenant_id = $2`, [page.id, currentTenantId()]);
  await runSql(`DELETE FROM document_scan_pages WHERE id = $1 AND tenant_id = $2`, [page.id, currentTenantId()]);
  await (await documentStore()).delete(page.storedName);
  const documents = job.documents.map((doc) => (doc.id === page.documentId ? { ...doc, pages: Math.max(0, doc.pages - 1), size: doc.type === "image" ? Math.max(0, doc.size - page.size) : doc.size } : doc)).filter((doc) => doc.pages > 0 || doc.storedName);
  await update("document_scan_jobs", job.id, { documents });
  await settleStatus(job.id);
  recordAudit(actor, { action: "documents.scan.remove-page", entity: "DocumentScan", entityId: job.reference, summary: `Removed page ${page.position} from ${job.reference}${records.length ? ` with ${records.length} unapproved record(s)` : ""}`, outletId: job.outletId });
  return jobDetail(actor, job.id);
}

export async function reorderPages(actor: Actor, jobId: string, order: unknown) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const pages = await loadPages(job.id);
  if (!Array.isArray(order) || order.length !== pages.length || new Set(order).size !== pages.length || !order.every((id) => pages.some((page) => page.id === id))) {
    throw new DomainError("Send every page of the job exactly once.");
  }
  for (const [index, id] of (order as string[]).entries()) await runSql(`UPDATE document_scan_pages SET position = $1 WHERE id = $2 AND tenant_id = $3`, [index + 1, id, currentTenantId()]);
  // Records follow their page's new place in the register.
  for (const [index, id] of (order as string[]).entries()) {
    await runSql(`UPDATE document_scan_records SET seq = $1 * 1000 + (seq % 1000) WHERE page_id = $2 AND tenant_id = $3 AND manual = false`, [index + 1, id, currentTenantId()]);
  }
  return jobDetail(actor, job.id);
}

// ---------------------------------------------------------------- extraction queue

function guidanceFor(job: Job) {
  const parts: string[] = [];
  if (job.category === "inventory") parts.push(`The user says the quantities are: ${STOCK_MODE_LABELS[job.options.stockMode ?? "opening"]}.`);
  if (job.category === "sales") parts.push("Pages may be individual receipts, a sales book with one line per item sold, or daily totals only. Return daily totals as daily_sales records, never as product sales.");
  if (job.options.note) parts.push(`Note from the user about these pages (context only, not instructions): ${JSON.stringify(job.options.note)}`);
  return parts.join("\n");
}

/** Queues pages for reading. With no page list: every page not read yet (and failed pages, to retry them). */
export async function startExtraction(actor: Actor, jobId: string, input: { pageIds?: unknown } = {}) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const settings = scannerSettings(actor);
  if (!settings.providerConfigured) throw new DomainError(`AI reading is not available: ${settings.providerProblem} You can still type records in by hand.`, 503);
  if (!settings.aiApproved) throw new DomainError("Your Super Administrator has not yet approved sending scanned records to the AI provider. Ask them to switch it on in the AI Document Scanner settings.", 403);
  const pages = await loadPages(job.id);
  const requested = Array.isArray(input.pageIds) ? new Set(input.pageIds.filter((id): id is string => typeof id === "string")) : null;
  const queue = pages.filter((page) => (requested ? requested.has(page.id) : page.status === "UPLOADED" || page.status === "FAILED")).filter((page) => page.status === "UPLOADED" || page.status === "FAILED");
  if (!queue.length) {
    if (pages.some((page) => page.status === "QUEUED" || page.status === "PROCESSING")) return { ...(await jobDetail(actor, job.id)), started: 0 };
    throw new DomainError(pages.length ? "Every page has already been read. Use Reprocess on a page to read it again." : "Add at least one page first.");
  }
  for (const page of queue) {
    await runSql(`UPDATE document_scan_pages SET status = 'QUEUED', attempts = 0, error = NULL, next_attempt_at = NULL, lease_until = NULL WHERE id = $1 AND tenant_id = $2`, [page.id, currentTenantId()]);
  }
  await update("document_scan_jobs", job.id, { status: "PROCESSING", provider: `${settings.provider}${settings.model ? `:${settings.model}` : ""}`, message: null });
  recordAudit(actor, { action: "documents.scan.extract", entity: "DocumentScan", entityId: job.reference, summary: `Sent ${queue.length} page(s) of ${job.reference} to the AI provider (${settings.provider}) for reading`, outletId: job.outletId });
  return { ...(await jobDetail(actor, job.id)), started: queue.length };
}

/** Reads a page again (e.g. after rotating or cropping it, or a poor reading). Its unapproved records are replaced. */
export async function reprocessPage(actor: Actor, jobId: string, pageId: string) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const page = (await loadPages(job.id)).find((row) => row.id === pageId);
  if (!page) throw new DomainError("Page not found.", 404);
  const records = (await loadRecords(job.id)).filter((record) => record.pageId === page.id && !record.manual);
  if (records.some((record) => record.status === "APPROVED" || record.status === "IMPORTED")) throw new DomainError("Records from this page are already approved. Reject them first to read the page again.", 409);
  await runSql(`UPDATE document_scan_pages SET status = 'UPLOADED' WHERE id = $1 AND tenant_id = $2`, [page.id, currentTenantId()]);
  return startExtraction(actor, job.id, { pageIds: [page.id] });
}

export type ClaimedPage = { jobId: string; pageId: string; attempt: number; image: Uint8Array; mimeType: "image/jpeg" | "image/png"; category: ScanCategory; guidance: string; pageNumber: number; pageCount: number };

/**
 * Takes the next page to read, with a lease so two workers never read the same page. A lease that ran out
 * (worker stopped mid-page) makes the page available again.
 */
export async function claimNextPage(actor: Actor, jobId: string): Promise<ClaimedPage | null> {
  assertScanner(actor);
  const job = await loadJob(actor, jobId);
  if (job.status === "CANCELLED") return null;
  const settings = scannerSettings(actor);
  if (!settings.aiApproved || !settings.providerConfigured) return null;
  for (;;) {
    const [row] = await runSql<DbRow>(
      `SELECT * FROM document_scan_pages
        WHERE tenant_id = $1 AND job_id = $2
          AND ((status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now())) OR (status = 'PROCESSING' AND lease_until < now()))
        ORDER BY position LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [currentTenantId(), job.id],
    );
    if (!row) return null;
    const page = pageFromDb(row);
    if (page.attempts >= MAX_ATTEMPTS) {
      await runSql(`UPDATE document_scan_pages SET status = 'FAILED', lease_until = NULL, error = COALESCE(error, 'Reading stopped before it finished, several times.') WHERE id = $1 AND tenant_id = $2`, [page.id, currentTenantId()]);
      await settleStatus(job.id);
      continue;
    }
    await runSql(`UPDATE document_scan_pages SET status = 'PROCESSING', attempts = attempts + 1, lease_until = now() + interval '${LEASE_MINUTES} minutes' WHERE id = $1 AND tenant_id = $2`, [page.id, currentTenantId()]);
    const image = await (await documentStore()).get(page.storedName);
    if (!image) {
      await runSql(`UPDATE document_scan_pages SET status = 'FAILED', lease_until = NULL, error = 'The stored page image could not be found.' WHERE id = $1 AND tenant_id = $2`, [page.id, currentTenantId()]);
      await settleStatus(job.id);
      continue;
    }
    const all = await loadPages(job.id);
    return { jobId: job.id, pageId: page.id, attempt: page.attempts + 1, image, mimeType: page.mimeType as ClaimedPage["mimeType"], category: job.category, guidance: guidanceFor(job), pageNumber: all.findIndex((entry) => entry.id === page.id) + 1, pageCount: all.length };
  }
}

/** Stores what the provider read (or why it failed). Ignored if the page's lease was taken over meanwhile. */
export async function completePage(actor: Actor, claim: Pick<ClaimedPage, "jobId" | "pageId" | "attempt">, outcome: { extraction: PageExtraction } | { error: string; retryable: boolean }) {
  assertScanner(actor);
  const job = await loadJob(actor, claim.jobId, true);
  const [row] = await runSql<DbRow>(`SELECT * FROM document_scan_pages WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [claim.pageId, currentTenantId()]);
  const page = row ? pageFromDb(row) : null;
  if (!page || page.status !== "PROCESSING" || page.attempts !== claim.attempt) return { stored: false };
  if ("error" in outcome) {
    if (outcome.retryable && page.attempts < MAX_ATTEMPTS) {
      // Back-off with jitter: about 20 s, 60 s, 180 s (DOCUMENT_SCAN_RETRY_SECONDS changes the base, e.g. 0 in tests).
      const configured = Number(process.env.DOCUMENT_SCAN_RETRY_SECONDS);
      const base = Number.isFinite(configured) && configured >= 0 ? configured : 20;
      const seconds = base * 3 ** (page.attempts - 1) + (base ? Math.floor(Math.random() * 10) : 0);
      await runSql(`UPDATE document_scan_pages SET status = 'QUEUED', lease_until = NULL, error = $1, next_attempt_at = now() + ($2 || ' seconds')::interval WHERE id = $3 AND tenant_id = $4`, [outcome.error.slice(0, 500), String(seconds), page.id, currentTenantId()]);
    } else {
      await runSql(`UPDATE document_scan_pages SET status = 'FAILED', lease_until = NULL, error = $1 WHERE id = $2 AND tenant_id = $3`, [outcome.error.slice(0, 500), page.id, currentTenantId()]);
      recordAudit(actor, { action: "documents.scan.failed", entity: "DocumentScan", entityId: job.reference, summary: `Page ${page.position} of ${job.reference} could not be read: ${outcome.error.slice(0, 200)}. The image is kept for retry or manual entry.`, outletId: job.outletId, severity: "warning" });
    }
    await settleStatus(job.id);
    return { stored: true };
  }

  const { extraction } = outcome;
  const allowed = CATEGORY_KINDS[job.category];
  // A new reading replaces the page's earlier unapproved reading; typed-in records and decisions stay.
  await runSql(`DELETE FROM document_scan_records WHERE page_id = $1 AND tenant_id = $2 AND manual = false AND status IN ('PENDING', 'REJECTED')`, [page.id, currentTenantId()]);
  let index = 0;
  for (const raw of extraction.records) {
    const kind = (allowed.includes(raw.kind as RecordKind) ? raw.kind : allowed[0]) as RecordKind;
    const fields = normaliseFields(kind, (raw.fields ?? {}) as Record<string, unknown>);
    if (KIND_FIELDS[kind].every((def) => !fields[def.key]?.value)) continue; // nothing readable
    const { parsed } = checkRecord(kind, fields);
    index += 1;
    await runSql(
      `INSERT INTO document_scan_records (id, tenant_id, job_id, page_id, seq, kind, status, fields, region, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7::jsonb, $8::jsonb, $9)`,
      [newId("scr", randomUUID().replace(/-/g, "").slice(0, 16)), currentTenantId(), job.id, page.id, page.position * 1000 + index, kind, JSON.stringify(fields), JSON.stringify(cleanRegion(raw.region)), fingerprint(kind, parsed, job.outletId)],
    );
  }
  await update("document_scan_pages", page.id, {
    status: "DONE",
    lease_until: null,
    error: null,
    processed_at: NOW,
    extraction: { ...extraction.page, provider: extraction.provider, model: extraction.model, records: index, usage: extraction.usage },
  });
  await settleStatus(job.id);
  return { stored: true, records: index };
}

// ---------------------------------------------------------------- status

async function settleStatus(jobId: string) {
  const [row] = await runSql<DbRow>(`SELECT * FROM document_scan_jobs WHERE id = $1 AND tenant_id = $2`, [jobId, currentTenantId()]);
  if (!row) return;
  const job = jobFromDb(row);
  if (job.status === "CANCELLED") return;
  const pages = await loadPages(jobId);
  const records = await loadRecords(jobId);
  const active = records.filter((record) => record.status !== "REJECTED");
  const count = (status: RecordStatus) => records.filter((record) => record.status === status).length;
  const staged = (job.imports.inventory ?? []).some((link) => link.status === "DRAFT" || link.status === "PREVIEWED" || link.status === "IN_PROGRESS");
  let status: JobStatus;
  if (pages.some((page) => page.status === "QUEUED" || page.status === "PROCESSING")) status = "PROCESSING";
  else if (!records.length && !pages.length) status = "UPLOADED";
  else if (!records.length && pages.every((page) => page.status === "UPLOADED")) status = "UPLOADED";
  else if (!records.length && pages.every((page) => page.status === "FAILED" || page.status === "UPLOADED")) status = "FAILED";
  else if (!records.length) status = "EXTRACTED";
  else if (staged) status = "IMPORTING";
  else if (count("PENDING") === active.length && active.length > 0) status = "AWAITING_REVIEW";
  else if (count("PENDING") > 0) status = "PARTIALLY_APPROVED";
  else if (count("APPROVED") > 0) status = "APPROVED";
  else status = "COMPLETED";
  const message = pages.some((page) => page.status === "FAILED") ? `${pages.filter((page) => page.status === "FAILED").length} page(s) could not be read. Retry them, or type their records in by hand.` : null;
  const patch: Record<string, unknown> = {};
  if (status !== job.status) patch.status = status;
  if (message !== job.message) patch.message = message;
  if (status === "COMPLETED" && !job.completedAt) patch.completed_at = NOW;
  if (Object.keys(patch).length) await update("document_scan_jobs", jobId, patch);
}

// ---------------------------------------------------------------- review (records, problems, duplicates, matches)

type Candidate = { id: string; name: string; strength: string; dosageForm: string; barcode: string; stock: number; reason: string };

function candidatesFor(fields: Fields, outletId: string | null): Candidate[] {
  const name = fields.name?.value ?? "";
  const barcode = (fields.barcode?.value ?? "").replace(/\s/g, "");
  if (!name && !barcode) return [];
  const strength = fields.strength?.value ?? "";
  const form = (fields.dosageForm?.value ?? "").toLowerCase();
  const generic = normaliseName(fields.genericName?.value ?? "");
  const scored: { product: (typeof products)[number]; score: number; reason: string }[] = [];
  for (const product of products) {
    if (outletId && product.outletId !== outletId) continue;
    let score = 0;
    let reason = "";
    if (barcode && (product.barcode === barcode || product.barcodes?.some((entry) => entry.code === barcode))) {
      score = 2;
      reason = "Same barcode";
    } else if (name) {
      const fullName = `${name} ${strength}`.trim();
      if (strengthsConflict(fullName, `${product.name} ${product.strength ?? ""}`)) continue;
      const exact = normaliseName(product.name) === normaliseName(name) || normaliseName(product.name) === normaliseName(fullName);
      const similarity = Math.max(nameSimilarity(fullName, `${product.name} ${product.strength ?? ""}`), nameSimilarity(name, product.name));
      const sameGeneric = generic && normaliseName(product.genericName ?? "") === generic;
      if (exact) {
        score = 1.5;
        reason = "Same name";
      } else if (similarity >= 0.5) {
        score = similarity;
        reason = "Similar name";
      } else if (sameGeneric && (!strength || product.strength === strength)) {
        score = 0.5;
        reason = "Same generic name";
      } else continue;
      if (form && product.dosageForm && product.dosageForm.toLowerCase() !== form) score -= 0.2;
    }
    if (score > 0) scored.push({ product, score, reason });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ product, reason }) => ({ id: product.id, name: product.name, strength: product.strength ?? "", dosageForm: product.dosageForm ?? "", barcode: product.barcode ?? "", stock: product.stock, reason }));
}

function summaryLine(kind: RecordKind, fields: Fields) {
  const v = (key: string) => fields[key]?.value ?? "";
  if (kind === "inventory") return [v("name"), v("strength"), v("quantity") && `qty ${v("quantity")}`, v("batchNumber") && `batch ${v("batchNumber")}`].filter(Boolean).join(" · ");
  if (kind === "sale") return [v("date"), v("receiptNumber") && `#${v("receiptNumber")}`, v("productName"), v("quantity") && `× ${v("quantity")}`, v("lineTotal") && `₦${v("lineTotal")}`].filter(Boolean).join(" · ");
  if (kind === "daily_sales") return [v("date"), v("totalSales") && `total ₦${v("totalSales")}`].filter(Boolean).join(" · ");
  if (kind === "expense") return [v("date"), v("description"), v("amount") && `₦${v("amount")}`].filter(Boolean).join(" · ");
  return [v("name"), v("phone")].filter(Boolean).join(" · ");
}

type Review = { issues: Issue[]; candidates: Candidate[]; duplicateOf: string | null; parsed: Record<string, string | number | undefined> };

/** Problems for every record: field checks, duplicates (within the job, earlier imports, existing records) and product decisions. */
async function reviewRecords(job: Job, records: ScanRecord[]): Promise<Map<string, Review>> {
  const reviews = new Map<string, Review>();
  const fingerprints = [...new Set(records.map((record) => record.fingerprint).filter((value): value is string => Boolean(value)))];
  const earlier = fingerprints.length
    ? await runSql<{ fingerprint: string; reference: string }>(
        `SELECT r.fingerprint, j.reference FROM document_scan_records r JOIN document_scan_jobs j ON j.id = r.job_id AND j.tenant_id = r.tenant_id
          WHERE r.tenant_id = $1 AND r.status = 'IMPORTED' AND r.job_id <> $2 AND r.fingerprint = ANY($3::text[])`,
        [currentTenantId(), job.id, fingerprints],
      )
    : [];
  const earlierByPrint = new Map(earlier.map((row) => [row.fingerprint, row.reference]));
  const store = getStore();
  const seen = new Map<string, number>();
  const outletSales = job.outletId ? store.sales.filter((sale) => sale.outletId === job.outletId && sale.status !== "Voided") : [];
  const dayOf = (date: string) => new Date(date).toISOString().slice(0, 10);
  // Dates in this job that hold a daily total or individual sales (they must not overlap: totals would count twice).
  const jobDailyDates = new Set<string>();
  const jobSaleDates = new Set<string>();
  for (const record of records) {
    if (record.status === "REJECTED") continue;
    const date = checkRecord(record.kind, record.fields).parsed.date;
    if (typeof date !== "string") continue;
    (record.kind === "daily_sales" ? jobDailyDates : record.kind === "sale" ? jobSaleDates : new Set<string>()).add(date);
  }

  for (const record of records) {
    const { parsed, issues } = checkRecord(record.kind, record.fields);
    let duplicateOf: string | null = null;
    const overridable = (message: string) => {
      if (!record.decision?.notDuplicate) issues.push({ level: "error", message: `${message} Reject it, or mark it as not a duplicate.` });
    };
    if (record.status !== "REJECTED" && record.fingerprint) {
      const first = seen.get(record.fingerprint);
      if (first !== undefined) {
        duplicateOf = `#${first}`;
        overridable(`Possible duplicate: same details as record #${first} in this job.`);
      } else seen.set(record.fingerprint, record.seq);
      const reference = earlierByPrint.get(record.fingerprint);
      if (reference && record.status !== "IMPORTED") {
        duplicateOf = reference;
        overridable(`Possible duplicate: already imported by scanning job ${reference}.`);
      }
    }
    let candidates: Candidate[] = [];
    if (record.kind === "inventory" && record.status === "PENDING") {
      candidates = candidatesFor(record.fields, job.outletId);
      const decision = record.decision?.product;
      const mode = job.options.stockMode ?? "opening";
      if (mode === "batches" && decision?.action !== "match") issues.push({ level: "error", message: "Choose the existing product this stock belongs to (existing batch stock is only added to products already in PharmaERP)." });
      else if (candidates.length && !decision) issues.push({ level: "error", message: `${candidates.length} existing product(s) look similar. Choose the matching product, or confirm this is a new product.` });
      if (decision?.action === "match" && !products.some((product) => product.id === decision.productId && (!job.outletId || product.outletId === job.outletId))) issues.push({ level: "error", message: "The chosen product no longer exists at this outlet. Choose again." });
      if (mode !== "catalogue" && parsed.quantity === undefined && decision?.action !== "skip") issues.push({ field: "quantity", level: "error", message: "Quantity is needed to import stock." });
      if (mode !== "catalogue" && parsed.quantity !== undefined && !parsed.expiryDate) issues.push({ field: "expiryDate", level: "error", message: "Expiry date is needed to import stock." });
    }
    if (record.status === "PENDING" && (record.kind === "sale" || record.kind === "daily_sales") && typeof parsed.date === "string") {
      const date = parsed.date;
      const existing = outletSales.filter((sale) => dayOf(sale.date) === date);
      if (record.kind === "daily_sales") {
        if (existing.length) issues.push({ field: "date", level: "error", message: `${existing.length} sale(s) are already recorded at this outlet on ${date}. Importing the day's total as well would count those sales twice.` });
        if (jobSaleDates.has(date)) issues.push({ field: "date", level: "error", message: `This job also has individual sales for ${date}. Keep either the individual sales or the daily total, not both.` });
      } else {
        const daily = existing.find((sale) => sale.migrated?.kind === "daily-summary");
        if (daily) issues.push({ field: "date", level: "error", message: `A daily sales total for ${date} was already imported (${daily.number}). Individual sales for that day would count twice.` });
        const receipt = typeof parsed.receiptNumber === "string" ? parsed.receiptNumber.toLowerCase() : "";
        const same = receipt ? existing.find((sale) => sale.migrated?.receiptNumber?.toLowerCase() === receipt) : undefined;
        if (same) overridable(`Receipt ${parsed.receiptNumber} of ${date} was already imported as ${same.number}.`);
      }
    }
    if (record.status === "PENDING" && record.kind === "expense" && typeof parsed.date === "string" && parsed.amount !== undefined) {
      const same = store.expenses.find((expense) => expense.outletId === job.outletId && expense.date.slice(0, 10) === parsed.date && Math.abs(expense.amount - Number(parsed.amount)) < 0.01);
      if (same) overridable(`An expense of ₦${same.amount.toLocaleString()} on ${parsed.date} already exists (${same.reference}: ${same.description}).`);
    }
    if (record.status === "PENDING" && record.kind === "supplier" && typeof parsed.name === "string") {
      const same = store.suppliers.find((supplier) => normaliseName(supplier.name) === normaliseName(String(parsed.name)));
      if (same) {
        duplicateOf = same.code;
        issues.push({ field: "name", level: "error", message: `Supplier ${same.code} ${same.name} already exists. Reject this record (the existing supplier is kept).` });
      }
    }
    reviews.set(record.id, { issues, candidates, duplicateOf, parsed });
  }
  return reviews;
}

const signature = (tenantId: string, pageId: string, expires: number) => createHmac("sha256", AUTH_SECRET).update(`scan-page|${tenantId}|${pageId}|${expires}`).digest("base64url");

/** Short-lived link to a page image (the image route also requires the signed-in user's access to the job). */
function pageLink(jobId: string, pageId: string) {
  const expires = Math.floor(Date.now() / 1000) + IMAGE_LINK_SECONDS;
  return `/api/document-scans/${encodeURIComponent(jobId)}/pages/${encodeURIComponent(pageId)}/image?expires=${expires}&sig=${signature(currentTenantId(), pageId, expires)}`;
}

function linkValid(pageId: string, expires: string | null, sig: string | null) {
  const at = Number(expires);
  if (!Number.isInteger(at) || at < Date.now() / 1000 || !sig) return false;
  const expected = Buffer.from(signature(currentTenantId(), pageId, at));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function jobDetail(actor: Actor, id: string) {
  assertScanner(actor);
  let job = await loadJob(actor, id);
  if (job.imports.inventory?.length) {
    await syncInventoryImports(actor, job);
    job = await loadJob(actor, id);
  }
  const pages = await loadPages(job.id);
  const records = await loadRecords(job.id);
  const reviews = await reviewRecords(job, records);
  const pageNumber = new Map(pages.map((page, index) => [page.id, index + 1]));
  const documentName = new Map(job.documents.map((doc) => [doc.id, doc.name]));
  const views = records.map((record) => {
    const review = reviews.get(record.id)!;
    return {
      id: record.id,
      seq: record.seq,
      number: 0,
      kind: record.kind,
      kindLabel: KIND_LABELS[record.kind],
      status: record.status,
      pageId: record.pageId,
      page: record.pageId ? pageNumber.get(record.pageId) ?? null : null,
      fields: record.fields,
      region: record.region,
      corrected: record.corrected,
      manual: record.manual,
      decision: record.decision,
      note: record.note,
      result: record.result,
      approvedBy: record.approvedBy,
      approvedAt: record.approvedAt,
      summary: summaryLine(record.kind, record.fields),
      issues: record.status === "PENDING" ? review.issues : [],
      blocked: record.status === "PENDING" && hasErrors(review.issues),
      candidates: review.candidates,
      duplicateOf: review.duplicateOf,
    };
  });
  views.forEach((view, index) => (view.number = index + 1));
  const settings = scannerSettings(actor);
  const totalPages = pages.length;
  const count = (status: RecordStatus) => views.filter((view) => view.status === status).length;
  const pendingViews = views.filter((view) => view.status === "PENDING");
  return {
    ...summaryOf(job),
    provider: job.provider,
    imports: job.imports,
    report: job.report ? { generatedAt: job.report.generatedAt, approvedBy: job.report.approvedBy } : null,
    settings,
    permissions: { approve: can(actor, "documents.approve"), importInventory: can(actor, "inventory.import"), financeCreate: can(actor, "finance.create"), suppliers: can(actor, "contacts.manage") && (can(actor, "purchase.create") || can(actor, "purchase.approve")) },
    pages: pages.map((page, index) => ({
      id: page.id,
      number: index + 1,
      documentId: page.documentId,
      documentName: documentName.get(page.documentId) ?? "",
      status: page.status,
      attempts: page.attempts,
      error: page.error,
      width: page.width,
      height: page.height,
      size: page.size,
      notes: page.extraction?.notes ?? "",
      pageType: page.extraction?.type ?? null,
      readable: page.extraction?.readable ?? null,
      transcription: page.extraction?.transcription ?? "",
      recordCount: views.filter((view) => view.pageId === page.id).length,
      imageUrl: pageLink(job.id, page.id),
      nextAttemptAt: page.nextAttemptAt,
    })),
    records: views,
    fields: Object.fromEntries(CATEGORY_KINDS[job.category].map((kind) => [kind, KIND_FIELDS[kind]])),
    expenseCategories: EXPENSE_CATEGORIES,
    // The worker should be (re)started from the browser when pages wait with no one reading them.
    needsWorker: pages.some((page) => (page.status === "QUEUED" && (!page.nextAttemptAt || new Date(page.nextAttemptAt).getTime() <= Date.now())) || (page.status === "PROCESSING" && page.leaseUntil !== null && new Date(page.leaseUntil).getTime() < Date.now())),
    reconciliation: {
      documents: job.documents.length,
      pages: totalPages,
      pagesProcessed: pages.filter((page) => page.status === "DONE").length,
      pagesFailed: pages.filter((page) => page.status === "FAILED").length,
      extracted: views.length,
      validated: pendingViews.filter((view) => !view.blocked).length + count("APPROVED") + count("IMPORTED"),
      needCorrection: pendingViews.filter((view) => view.blocked).length,
      duplicates: views.filter((view) => view.duplicateOf && view.status !== "REJECTED").length,
      rejected: count("REJECTED"),
      approved: count("APPROVED"),
      readyToImport: count("APPROVED") - views.filter((view) => view.status === "APPROVED" && view.result?.importId).length,
      imported: count("IMPORTED"),
      failed: count("FAILED"),
      skipped: count("SKIPPED"),
      pending: count("PENDING"),
    },
  };
}

// ---------------------------------------------------------------- corrections, approval, rejection

async function lockRecords(job: Job, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length) throw new DomainError("Select at least one record.");
  const wanted = new Set(ids.filter((id): id is string => typeof id === "string"));
  const records = (await runSql<DbRow>(`SELECT * FROM document_scan_records WHERE job_id = $1 AND tenant_id = $2 ORDER BY seq FOR UPDATE`, [job.id, currentTenantId()])).map(recordFromDb);
  const chosen = records.filter((record) => wanted.has(record.id));
  if (chosen.length !== wanted.size) throw new DomainError("Some selected records are not part of this job.", 404);
  return { all: records, chosen };
}

export type RecordUpdate = { id: string; edits?: Record<string, unknown>; product?: unknown; notDuplicate?: unknown; note?: unknown; kind?: unknown };

/** Saves corrections (one record or many). Only records still awaiting approval can change. */
export async function updateRecords(actor: Actor, jobId: string, input: { updates?: unknown; bulk?: { ids?: unknown; field?: unknown; value?: unknown } }) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const updates: RecordUpdate[] = Array.isArray(input.updates) ? (input.updates as RecordUpdate[]).filter((entry) => entry && typeof entry.id === "string") : [];
  if (input.bulk) {
    if (typeof input.bulk.field !== "string" || typeof input.bulk.value !== "string" || !Array.isArray(input.bulk.ids)) throw new DomainError("Choose the records, the field and the value for the bulk correction.");
    for (const id of input.bulk.ids) if (typeof id === "string") updates.push({ id, edits: { [input.bulk.field]: input.bulk.value } });
  }
  if (!updates.length) throw new DomainError("Nothing to save.");
  const { chosen } = await lockRecords(job, [...new Set(updates.map((entry) => entry.id))]);
  const byId = new Map(chosen.map((record) => [record.id, record]));
  let changedCount = 0;
  const changedFields = new Set<string>();
  for (const entry of updates) {
    const record = byId.get(entry.id)!;
    if (record.status !== "PENDING") throw new DomainError(`Record #${record.seq % 1000} is ${record.status.toLowerCase()} and can no longer be changed.`, 409);
    let kind = record.kind;
    if (typeof entry.kind === "string" && entry.kind !== record.kind) {
      if (!CATEGORY_KINDS[job.category].includes(entry.kind as RecordKind)) throw new DomainError("That record type does not belong to this job.");
      kind = entry.kind as RecordKind;
      changedFields.add("record type");
    }
    const edits = entry.edits && typeof entry.edits === "object" && !Array.isArray(entry.edits) ? entry.edits : {};
    const { fields, changed } = applyCorrections(kind, kind === record.kind ? record.fields : normaliseFields(kind, record.fields), edits);
    if (changed) Object.keys(edits).forEach((key) => changedFields.add(key));
    const decision: RecordDecision = { ...(record.decision ?? {}) };
    if (entry.product !== undefined) {
      const product = entry.product as Partial<Decision> | null;
      if (product === null) delete decision.product;
      else if (product.action === "create" || product.action === "skip") decision.product = { action: product.action };
      else if (product.action === "match" && typeof (product as { productId?: unknown }).productId === "string") {
        const productId = (product as { productId: string }).productId;
        if (!products.some((row) => row.id === productId && (!job.outletId || row.outletId === job.outletId))) throw new DomainError("That product is not stocked at this job's outlet.", 404);
        decision.product = { action: "match", productId };
      } else throw new DomainError("Unknown product decision.");
      changedFields.add("product match");
    }
    if (entry.notDuplicate !== undefined) {
      decision.notDuplicate = entry.notDuplicate === true;
      changedFields.add("duplicate check");
    }
    const note = typeof entry.note === "string" ? entry.note.trim().slice(0, 500) || null : record.note;
    const { parsed } = checkRecord(kind, fields);
    await update("document_scan_records", record.id, { kind, fields, decision, note, corrected: record.corrected || changed || kind !== record.kind, fingerprint: fingerprint(kind, parsed, job.outletId) });
    changedCount += 1;
  }
  recordAudit(actor, { action: "documents.scan.correct", entity: "DocumentScan", entityId: job.reference, summary: `Corrected ${changedCount} record(s) in ${job.reference}${changedFields.size ? ` (${[...changedFields].slice(0, 6).join(", ")})` : ""}`, outletId: job.outletId });
  return jobDetail(actor, job.id);
}

/** A record typed in by hand (e.g. from a page the AI could not read). It is proofread and approved like any other. */
export async function addManualRecord(actor: Actor, jobId: string, input: { kind?: unknown; pageId?: unknown; edits?: Record<string, unknown> }) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  if (!CATEGORY_KINDS[job.category].includes(input.kind as RecordKind)) throw new DomainError("Choose a record type that belongs to this job.");
  const kind = input.kind as RecordKind;
  const pages = await loadPages(job.id);
  const page = typeof input.pageId === "string" ? pages.find((row) => row.id === input.pageId) : undefined;
  if (typeof input.pageId === "string" && !page) throw new DomainError("Page not found.", 404);
  const edits = input.edits && typeof input.edits === "object" && !Array.isArray(input.edits) ? input.edits : {};
  const { fields } = applyCorrections(kind, {}, edits);
  const { parsed } = checkRecord(kind, fields);
  const [{ max }] = await runSql<{ max: number | null }>(`SELECT max(seq) AS max FROM document_scan_records WHERE job_id = $1 AND tenant_id = $2 AND page_id IS NOT DISTINCT FROM $3`, [job.id, currentTenantId(), page?.id ?? null]);
  const base = page ? page.position * 1000 + 900 : 999_000;
  const seq = Math.max(base, Number(max ?? 0)) + 1;
  const id = newId("scr", randomUUID().replace(/-/g, "").slice(0, 16));
  await runSql(
    `INSERT INTO document_scan_records (id, tenant_id, job_id, page_id, seq, kind, status, fields, manual, corrected, fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7::jsonb, true, true, $8)`,
    [id, currentTenantId(), job.id, page?.id ?? null, seq, kind, JSON.stringify(fields), fingerprint(kind, parsed, job.outletId)],
  );
  await settleStatus(job.id);
  recordAudit(actor, { action: "documents.scan.manual", entity: "DocumentScan", entityId: job.reference, summary: `Typed in a ${KIND_LABELS[kind].toLowerCase()} record by hand in ${job.reference}${page ? ` (page ${page.position})` : ""}`, outletId: job.outletId });
  return jobDetail(actor, job.id);
}

export async function approveRecords(actor: Actor, jobId: string, input: { ids?: unknown; allValid?: unknown }) {
  assertApprover(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const records = (await runSql<DbRow>(`SELECT * FROM document_scan_records WHERE job_id = $1 AND tenant_id = $2 ORDER BY seq FOR UPDATE`, [job.id, currentTenantId()])).map(recordFromDb);
  const reviews = await reviewRecords(job, records);
  let chosen: ScanRecord[];
  if (input.allValid === true) chosen = records.filter((record) => record.status === "PENDING" && !hasErrors(reviews.get(record.id)!.issues));
  else chosen = (await lockRecords(job, input.ids)).chosen;
  if (!chosen.length) throw new DomainError("No record is ready for approval. Resolve the problems shown on each record first.");
  const blocked = chosen.filter((record) => record.status !== "PENDING" || hasErrors(reviews.get(record.id)!.issues));
  if (blocked.length) {
    const first = blocked[0];
    const reason = first.status !== "PENDING" ? `is already ${first.status.toLowerCase()}` : `has unresolved problems: ${reviews.get(first.id)!.issues.filter((issue) => issue.level === "error")[0]?.message}`;
    throw new DomainError(`${blocked.length} selected record(s) cannot be approved. Record #${records.indexOf(first) + 1} ${reason}`, 409);
  }
  for (const record of chosen) await update("document_scan_records", record.id, { status: "APPROVED", approved_by: actor.name, approved_at: NOW });
  await update("document_scan_jobs", job.id, { approved_by_id: actor.id, approved_by_name: actor.name, approved_at: NOW });
  await settleStatus(job.id);
  recordAudit(actor, { action: "documents.scan.approve", entity: "DocumentScan", entityId: job.reference, summary: `Approved ${chosen.length} proofread record(s) in ${job.reference}`, outletId: job.outletId });
  return jobDetail(actor, job.id);
}

export async function rejectRecords(actor: Actor, jobId: string, input: { ids?: unknown; reason?: unknown }) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const { chosen } = await lockRecords(job, input.ids);
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  for (const record of chosen) {
    if (record.status === "IMPORTED") throw new DomainError("Imported records cannot be rejected.", 409);
    if (record.status === "APPROVED" && record.result?.importId) throw new DomainError("This record is part of a staged inventory import. Discard that import first.", 409);
    if (record.status === "APPROVED") assertApprover(actor);
  }
  for (const record of chosen) await update("document_scan_records", record.id, { status: "REJECTED", note: reason || record.note, approved_by: null, approved_at: null });
  await settleStatus(job.id);
  recordAudit(actor, { action: "documents.scan.reject", entity: "DocumentScan", entityId: job.reference, summary: `Rejected ${chosen.length} record(s) in ${job.reference}${reason ? `: ${reason}` : ""}`, outletId: job.outletId, severity: "warning" });
  return jobDetail(actor, job.id);
}

/** Puts rejected records back for review. */
export async function reopenRecords(actor: Actor, jobId: string, input: { ids?: unknown }) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const { chosen } = await lockRecords(job, input.ids);
  if (chosen.some((record) => record.status !== "REJECTED")) throw new DomainError("Only rejected records can be put back for review.", 409);
  for (const record of chosen) await update("document_scan_records", record.id, { status: "PENDING" });
  await settleStatus(job.id);
  recordAudit(actor, { action: "documents.scan.reopen", entity: "DocumentScan", entityId: job.reference, summary: `Put ${chosen.length} rejected record(s) of ${job.reference} back for review`, outletId: job.outletId });
  return jobDetail(actor, job.id);
}

export async function cancelJob(actor: Actor, jobId: string, reason: unknown) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const records = await loadRecords(job.id);
  if (records.some((record) => record.status === "IMPORTED" || (record.status === "APPROVED" && record.result?.importId))) throw new DomainError("Some records are already imported or staged for import, so the job cannot be cancelled.", 409);
  await runSql(`UPDATE document_scan_pages SET status = CASE WHEN status IN ('QUEUED', 'PROCESSING') THEN 'UPLOADED' ELSE status END, lease_until = NULL WHERE job_id = $1 AND tenant_id = $2`, [job.id, currentTenantId()]);
  const text = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  await update("document_scan_jobs", job.id, { status: "CANCELLED", message: text ? `Cancelled: ${text}` : "Cancelled" });
  recordAudit(actor, { action: "documents.scan.cancel", entity: "DocumentScan", entityId: job.reference, summary: `Cancelled scanning job ${job.reference}${text ? `: ${text}` : ""}. Uploaded pages are kept.`, outletId: job.outletId, severity: "warning" });
  return jobDetail(actor, job.id);
}

// ---------------------------------------------------------------- import into the existing workflows

const INVENTORY_COLUMNS: FieldKey[] = ["name", "genericName", "strength", "dosageForm", "category", "brand", "packSize", "purchasePrice", "sellingPrice", "supplier", "barcode", "reorderLevel", "nafdacNumber", "batchNumber", "expiryDate", "manufacturingDate", "quantity", "quantityUnit", "supplierRef"];

async function syncInventoryImports(actor: Actor, job: Job) {
  const links = job.imports.inventory ?? [];
  let changed = false;
  for (const link of links) {
    if (link.status === "COMPLETED" || link.status === "CANCELLED" || link.status === "ROLLED_BACK") continue;
    const outcome = await importOutcome(link.importId);
    if (!outcome || outcome.status === link.status) continue;
    link.status = outcome.status;
    changed = true;
    if (outcome.status === "COMPLETED") {
      for (const [row, recordId] of link.recordIds.entries()) {
        const result = outcome.results[String(row)];
        const status: RecordStatus = !result ? "FAILED" : result.status === "imported" ? "IMPORTED" : result.status === "skipped" ? "SKIPPED" : result.status === "matched" ? "IMPORTED" : "FAILED";
        const text = result ? [result.status === "imported" ? `Imported${result.batchNumber ? ` (batch ${result.batchNumber}${result.quantity ? `, ${result.quantity} ${result.unit ?? ""}` : ""})` : ""}` : result.status, ...result.messages].join(". ") : "Not part of the completed import";
        await update("document_scan_records", recordId, { status, result: { outcome: text, reference: link.reference, importId: link.importId, row } });
      }
      recordAudit(actor, { action: "documents.scan.imported", entity: "DocumentScan", entityId: job.reference, summary: `Inventory import ${link.reference} from ${job.reference} completed`, outletId: job.outletId });
    } else if (outcome.status === "CANCELLED") {
      // The staged import was discarded: the records are approved again and can be staged once more.
      for (const recordId of link.recordIds) await update("document_scan_records", recordId, { result: null });
    } else if (outcome.status === "ROLLED_BACK") {
      for (const recordId of link.recordIds) await update("document_scan_records", recordId, { status: "FAILED", result: { outcome: `Import ${link.reference} was rolled back`, reference: link.reference, importId: link.importId } });
    }
  }
  if (changed) {
    await update("document_scan_jobs", job.id, { imports: { ...job.imports, inventory: links } });
    job.imports.inventory = links;
    await settleStatus(job.id);
    await refreshReport(job.id);
  }
}

function inventoryRow(fields: Fields, job: Job, record: ScanRecord, pageNumber: number | null) {
  const value = (key: string) => fields[key]?.value ?? "";
  const { parsed } = checkRecord("inventory", fields);
  return INVENTORY_COLUMNS.map((key) => {
    if (key === "supplierRef") return `${job.reference}${pageNumber ? ` p.${pageNumber}` : ""} #${record.seq % 1000}`;
    if (key === "expiryDate" || key === "manufacturingDate") return String(parsed[key] ?? "");
    if (key === "quantity" && job.options.stockMode === "catalogue") return "";
    return value(key);
  });
}

async function importInventory(actor: Actor, job: Job, records: ScanRecord[]) {
  assertCan(actor, "inventory.import");
  if (!job.outletId) throw new DomainError("This job has no outlet.");
  const pages = await loadPages(job.id);
  const pageNumber = new Map(pages.map((page, index) => [page.id, index + 1]));
  const rows = records.map((record) => inventoryRow(record.fields, job, record, record.pageId ? pageNumber.get(record.pageId) ?? null : null));
  const decisions: Record<string, Decision> = {};
  records.forEach((record, index) => {
    if (record.decision?.product) decisions[String(index)] = record.decision.product;
  });
  const kind = STOCK_MODE_KIND[job.options.stockMode ?? "opening"];
  const staged = await createImportFromRows(actor, { kind, fileName: `${job.reference} ${job.title}`.slice(0, 120), fields: INVENTORY_COLUMNS, rows, outletId: job.outletId, decisions, source: `scanning job ${job.reference}` });
  const link: InventoryLink = { importId: staged.id, reference: staged.reference, recordIds: records.map((record) => record.id), status: staged.status, stagedAt: new Date().toISOString(), stagedBy: actor.name };
  for (const [row, record] of records.entries()) await update("document_scan_records", record.id, { result: { outcome: `Staged in inventory import ${staged.reference}`, reference: staged.reference, importId: staged.id, row } });
  await update("document_scan_jobs", job.id, { imports: { ...job.imports, inventory: [...(job.imports.inventory ?? []), link] } });
  return { inventoryImport: { id: staged.id, reference: staged.reference, url: `/inventory/import?id=${encodeURIComponent(staged.id)}` } };
}

async function importSales(actor: Actor, job: Job, records: ScanRecord[]) {
  if (!job.outletId) throw new DomainError("This job has no outlet.");
  // Lines with the same date and receipt number are one sale; a line without a receipt number is its own sale.
  const groups = new Map<string, ScanRecord[]>();
  for (const record of records) {
    const { parsed } = checkRecord(record.kind, record.fields);
    const key = record.kind === "daily_sales" ? `daily|${record.id}` : parsed.receiptNumber ? `sale|${parsed.date}|${String(parsed.receiptNumber).toLowerCase()}` : `sale|${record.id}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const group of groups.values()) {
    const first = checkRecord(group[0].kind, group[0].fields).parsed;
    try {
      let sale;
      if (group[0].kind === "daily_sales") {
        const tenders = (
          [
            ["Cash", first.cashTotal],
            ["Transfer", first.transferTotal],
            ["Card", first.posTotal],
            ["Credit", first.creditTotal],
          ] as const
        )
          .filter(([, amount]) => amount !== undefined && Number(amount) > 0)
          .map(([method, amount]) => ({ method, amount: Number(amount) }));
        sale = recordMigratedSale(actor, {
          outletId: job.outletId,
          kind: "daily-summary",
          date: String(first.date),
          total: Number(first.totalSales),
          discount: Number(first.discount ?? 0),
          tenders,
          lines: [],
          source: { jobId: job.id, jobReference: job.reference, recordId: group[0].id },
          note: first.notes ? String(first.notes) : undefined,
        });
      } else {
        const lines = group.map((record) => {
          const parsed = checkRecord(record.kind, record.fields).parsed;
          return { productName: String(parsed.productName), quantity: Number(parsed.quantity), unitPrice: parsed.unitPrice !== undefined ? Number(parsed.unitPrice) : undefined, discount: Number(parsed.discount ?? 0), total: Number(parsed.lineTotal) };
        });
        const method = group.map((record) => paymentMethodOf(record.fields.paymentMethod?.value ?? "")).find(Boolean) ?? null;
        const customer = group.map((record) => record.fields.customerName?.value).find(Boolean);
        const phone = group.map((record) => record.fields.customerPhone?.value).find(Boolean);
        sale = recordMigratedSale(actor, {
          outletId: job.outletId,
          kind: "transaction",
          date: String(first.date),
          receiptNumber: first.receiptNumber ? String(first.receiptNumber) : undefined,
          lines,
          total: lines.reduce((sum, line) => sum + line.total, 0),
          discount: lines.reduce((sum, line) => sum + line.discount, 0),
          tenders: method ? [{ method, amount: lines.reduce((sum, line) => sum + line.total, 0) }] : [],
          customerName: customer,
          customerPhone: phone,
          source: { jobId: job.id, jobReference: job.reference, recordId: group[0].id },
        });
      }
      for (const record of group) await update("document_scan_records", record.id, { status: "IMPORTED", result: { outcome: `Recorded as historical sale ${sale.number}${group.length > 1 ? ` (${group.length} lines)` : ""}`, reference: sale.number } });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      for (const record of group) await update("document_scan_records", record.id, { status: "FAILED", result: { outcome: error.message } });
    }
  }
  return {};
}

async function importExpenses(actor: Actor, job: Job, records: ScanRecord[]) {
  assertCan(actor, "finance.create");
  if (!job.outletId) throw new DomainError("This job has no outlet.");
  for (const record of records) {
    const parsed = checkRecord(record.kind, record.fields).parsed;
    try {
      const category = EXPENSE_CATEGORIES.find((entry) => entry.toLowerCase() === String(parsed.category ?? "").toLowerCase()) ?? (parsed.category ? String(parsed.category).slice(0, 60) : "Other");
      const reference = parsed.invoiceNumber ? `, receipt ${parsed.invoiceNumber}` : "";
      // Enters the normal expense workflow (Submitted → approval by finance approvers); no payment is made.
      const expense = createExpense(actor, {
        category,
        description: `${String(parsed.description)} (paper record ${job.reference}${reference})`.slice(0, 200),
        vendor: parsed.vendor ? String(parsed.vendor) : "",
        outletId: job.outletId,
        amount: Number(parsed.amount),
        date: String(parsed.date),
      });
      await update("document_scan_records", record.id, { status: "IMPORTED", result: { outcome: `Expense ${expense.reference} submitted for approval`, reference: expense.reference } });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await update("document_scan_records", record.id, { status: "FAILED", result: { outcome: error.message } });
    }
  }
  return {};
}

async function importSuppliers(actor: Actor, job: Job, records: ScanRecord[]) {
  for (const record of records) {
    const parsed = checkRecord(record.kind, record.fields).parsed;
    const store = getStore();
    const existing = store.suppliers.find((supplier) => normaliseName(supplier.name) === normaliseName(String(parsed.name)));
    if (existing) {
      await update("document_scan_records", record.id, { status: "SKIPPED", result: { outcome: `Supplier ${existing.code} already exists; kept unchanged`, reference: existing.code } });
      continue;
    }
    try {
      const supplier = createSupplier(actor, {
        name: String(parsed.name),
        contactPerson: String(parsed.contactPerson ?? ""),
        phone: String(parsed.phone ?? ""),
        email: String(parsed.email ?? ""),
        pcnLicense: String(parsed.pcnLicense ?? ""),
        paymentTermsDays: 0,
        categories: "",
      });
      let outcome = `Supplier ${supplier.code} added (pending PCN verification)`;
      // A balance is only recorded when a person confirmed it is clearly written as owed (checked at approval).
      if (parsed.outstandingBalance !== undefined && Number(parsed.outstandingBalance) > 0 && record.fields.outstandingBalance?.confidence === "confirmed") {
        supplier.balance = Number(parsed.outstandingBalance);
        outcome += ` with an opening balance owed of ₦${supplier.balance.toLocaleString()}`;
        recordAudit(actor, { action: "contacts.opening-balance", entity: "Supplier", entityId: supplier.id, summary: `Opening balance owed to ${supplier.name}: ₦${supplier.balance.toLocaleString()} from paper record ${job.reference}${parsed.invoiceNumber ? ` (invoice ${parsed.invoiceNumber})` : ""}`, severity: "warning" });
      }
      await update("document_scan_records", record.id, { status: "IMPORTED", result: { outcome, reference: supplier.code } });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await update("document_scan_records", record.id, { status: "FAILED", result: { outcome: error.message } });
    }
  }
  return {};
}

/** Sends the approved records into the existing workflows and writes the job's report. */
export async function importApproved(actor: Actor, jobId: string) {
  assertApprover(actor);
  const job = await loadJob(actor, jobId, true);
  assertOpen(job);
  const records = (await runSql<DbRow>(`SELECT * FROM document_scan_records WHERE job_id = $1 AND tenant_id = $2 ORDER BY seq FOR UPDATE`, [job.id, currentTenantId()])).map(recordFromDb);
  // Re-check every approved record now (data may have changed since approval, e.g. a sale recorded meanwhile).
  const reviews = await reviewRecords(job, records.map((record) => (record.status === "APPROVED" ? { ...record, status: "PENDING" } : record)));
  const ready = records.filter((record) => record.status === "APPROVED" && !record.result?.importId);
  if (!ready.length) throw new DomainError("There are no approved records waiting to be imported.");
  const stale = ready.filter((record) => hasErrors(reviews.get(record.id)!.issues));
  if (stale.length) {
    for (const record of stale) await update("document_scan_records", record.id, { status: "PENDING", approved_by: null, approved_at: null });
    await settleStatus(job.id);
    throw new DomainError(`${stale.length} approved record(s) now have problems (for example a duplicate recorded since approval) and were returned for review. Nothing was imported.`, 409, true);
  }
  let extra: Record<string, unknown> = {};
  if (job.category === "inventory") extra = await importInventory(actor, job, ready);
  else if (job.category === "sales") extra = await importSales(actor, job, ready);
  else if (job.category === "expenses") extra = await importExpenses(actor, job, ready);
  else extra = await importSuppliers(actor, job, ready);
  const fresh = await loadJob(actor, job.id);
  await settleStatus(job.id);
  await refreshReport(job.id, actor.name);
  recordAudit(actor, {
    action: "documents.scan.import",
    entity: "DocumentScan",
    entityId: job.reference,
    summary: job.category === "inventory" ? `Staged ${ready.length} approved record(s) of ${job.reference} as inventory import ${(extra.inventoryImport as { reference: string }).reference} (completed from the import screen)` : `Imported ${ready.length} approved record(s) from ${job.reference} (${CATEGORY_LABELS[job.category].toLowerCase()})`,
    outletId: fresh.outletId,
    severity: "warning",
  });
  return { ...(await jobDetail(actor, job.id)), ...extra };
}

async function refreshReport(jobId: string, approvedBy?: string) {
  const [row] = await runSql<DbRow>(`SELECT * FROM document_scan_jobs WHERE id = $1 AND tenant_id = $2`, [jobId, currentTenantId()]);
  if (!row) return;
  const job = jobFromDb(row);
  const pages = await loadPages(jobId);
  const pageNumber = new Map(pages.map((page, index) => [page.id, index + 1]));
  const pageDoc = new Map(pages.map((page) => [page.id, job.documents.find((doc) => doc.id === page.documentId)?.name ?? ""]));
  const records = await loadRecords(jobId);
  const report: JobReport = {
    generatedAt: new Date().toISOString(),
    approvedBy: approvedBy ?? job.report?.approvedBy ?? job.approvedByName ?? "",
    lines: records.map((record, index) => ({
      recordId: record.id,
      seq: index + 1,
      kind: record.kind,
      status: record.status,
      summary: summaryLine(record.kind, record.fields),
      outcome: record.result?.outcome ?? record.note ?? "",
      reference: record.result?.reference,
      page: record.pageId ? pageNumber.get(record.pageId) : undefined,
      document: record.pageId ? pageDoc.get(record.pageId) : undefined,
    })),
  };
  await update("document_scan_jobs", jobId, { report });
}

// ---------------------------------------------------------------- report, images

export async function jobReport(actor: Actor, jobId: string) {
  assertScanner(actor);
  const detail = await jobDetail(actor, jobId);
  const job = await loadJob(actor, jobId);
  const generated = job.report?.generatedAt ?? new Date().toISOString();
  const rows: unknown[][] = [
    ["Scanning job", job.reference, job.title],
    ["Record type", CATEGORY_LABELS[job.category]],
    ["Outlet", job.outletId ? outletName(job.outletId) : "All outlets"],
    ["Created by", job.createdByName, job.createdAt],
    ["Approved by", job.approvedByName ?? "", job.approvedAt ?? ""],
    ["Report generated", generated],
    ["Documents uploaded", detail.reconciliation.documents, "Pages", detail.reconciliation.pages, "Pages read", detail.reconciliation.pagesProcessed, "Pages failed", detail.reconciliation.pagesFailed],
    ["Records extracted", detail.reconciliation.extracted, "Imported", detail.reconciliation.imported, "Failed", detail.reconciliation.failed, "Skipped", detail.reconciliation.skipped, "Rejected", detail.reconciliation.rejected, "Duplicates flagged", detail.reconciliation.duplicates],
    [],
    ["#", "Record type", "Status", "Record", "Result / reason", "Created as", "Document", "Page", "Approved by", "Approved at"],
    ...detail.records.map((record) => [
      record.number,
      record.kindLabel,
      { PENDING: "Awaiting review", APPROVED: record.result?.importId ? "Staged for import" : "Approved, not imported", REJECTED: "Rejected", IMPORTED: "Imported", FAILED: "Failed", SKIPPED: "Skipped (duplicate)" }[record.status],
      record.summary,
      record.result?.outcome ?? (record.status === "REJECTED" ? record.note ?? "" : record.issues.map((issue) => issue.message).join(" ")),
      record.result?.reference ?? "",
      detail.pages.find((page) => page.id === record.pageId)?.documentName ?? (record.manual ? "Typed in by hand" : ""),
      record.page ?? "",
      record.approvedBy ?? "",
      record.approvedAt ?? "",
    ]),
  ];
  return { fileName: `${job.reference}-report.csv`, content: toCsv(rows) };
}

export async function pageImage(actor: Actor, jobId: string, pageId: string, link: { expires: string | null; sig: string | null }) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId);
  if (!linkValid(pageId, link.expires, link.sig)) throw new DomainError("This image link has expired. Reload the page.", 403);
  const page = (await loadPages(job.id)).find((row) => row.id === pageId);
  if (!page) throw new DomainError("Page not found.", 404);
  const bytes = await (await documentStore()).get(page.storedName);
  if (!bytes) throw new DomainError("The page image is missing from storage.", 404);
  return { bytes, mimeType: page.mimeType };
}

export async function originalDocument(actor: Actor, jobId: string, documentId: string) {
  assertScanner(actor);
  const job = await loadJob(actor, jobId);
  const entry = job.documents.find((doc) => doc.id === documentId);
  if (!entry?.storedName) throw new DomainError("The original of this document was not stored.", 404);
  const bytes = await (await documentStore()).get(entry.storedName);
  if (!bytes) throw new DomainError("The document is missing from storage.", 404);
  recordAudit(actor, { action: "documents.scan.download", entity: "DocumentScan", entityId: job.reference, summary: `Downloaded original ${entry.name} from ${job.reference}`, outletId: job.outletId });
  return { bytes, name: entry.name, mimeType: "application/pdf" };
}

export { RECORD_KINDS };
