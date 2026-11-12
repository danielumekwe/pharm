-- AI Document Scanner (Data Import Centre): photographed or scanned paper records are stored, read by the
-- configured AI provider page by page, proofread by staff and only then passed to the existing workflows
-- (inventory_imports for products and stock, expenses, suppliers, migrated historical sales).
-- Nothing here holds stock or money balances. Page images live in the document store (regulatory_files or R2).
-- Historical sales entered from paper records are flagged in sales.migrated (TEXT holding JSON).
-- Additive; one transaction. Rollback: prisma/rollbacks/20261123090000_document_scans/down.sql

BEGIN;

ALTER TABLE "sales" ADD COLUMN "migrated" TEXT;

CREATE TABLE "document_scan_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "title" TEXT NOT NULL,
    "outlet_id" TEXT,
    -- Category options, e.g. what inventory quantities mean (catalogue only / opening stock / batch stock).
    "options" JSONB NOT NULL DEFAULT '{}',
    -- Original files as uploaded (name, type, size, pages), kept even when extraction fails.
    "documents" JSONB NOT NULL DEFAULT '[]',
    "provider" TEXT,
    -- Links to the workflows the approved records went into (inventory import ids, created record ids) and the final report.
    "imports" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB,
    "message" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_by_name" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "document_scan_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_scan_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_scan_jobs_outlet_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT "document_scan_jobs_category_check" CHECK ("category" IN ('inventory', 'sales', 'expenses', 'suppliers')),
    CONSTRAINT "document_scan_jobs_status_check" CHECK ("status" IN ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'AWAITING_REVIEW', 'PARTIALLY_APPROVED', 'APPROVED', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "document_scan_jobs_tenant_reference_key" ON "document_scan_jobs"("tenant_id", "reference");
CREATE INDEX "document_scan_jobs_tenant_created_idx" ON "document_scan_jobs"("tenant_id", "created_at" DESC);

-- One row per page image. Also the processing queue: QUEUED pages are claimed with a lease, retried with
-- back-off and marked FAILED after the last attempt (the image is never deleted by a failure).
CREATE TABLE "document_scan_pages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "stored_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6),
    "error" TEXT,
    -- What the provider returned for the page (transcription, page type, notes), kept for reprocessing and audit.
    "extraction" JSONB,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "document_scan_pages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_scan_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_scan_pages_job_fkey" FOREIGN KEY ("job_id") REFERENCES "document_scan_jobs"("id") ON DELETE CASCADE,
    CONSTRAINT "document_scan_pages_status_check" CHECK ("status" IN ('UPLOADED', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED'))
);
CREATE INDEX "document_scan_pages_job_idx" ON "document_scan_pages"("tenant_id", "job_id", "position");
-- The same photo cannot be added to a job twice.
CREATE UNIQUE INDEX "document_scan_pages_once_key" ON "document_scan_pages"("tenant_id", "job_id", "sha256");

-- Records read from the pages: every field keeps its value, confidence and the text as read.
CREATE TABLE "document_scan_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "page_id" TEXT,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "region" JSONB,
    "corrected" BOOLEAN NOT NULL DEFAULT false,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    -- Inventory: the reviewer's product decision (match an existing product / create / skip).
    "decision" JSONB,
    "fingerprint" TEXT,
    "note" TEXT,
    "result" JSONB,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "document_scan_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_scan_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_scan_records_job_fkey" FOREIGN KEY ("job_id") REFERENCES "document_scan_jobs"("id") ON DELETE CASCADE,
    CONSTRAINT "document_scan_records_kind_check" CHECK ("kind" IN ('inventory', 'sale', 'daily_sales', 'expense', 'supplier')),
    CONSTRAINT "document_scan_records_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'IMPORTED', 'FAILED', 'SKIPPED'))
);
CREATE INDEX "document_scan_records_job_idx" ON "document_scan_records"("tenant_id", "job_id", "seq");
CREATE INDEX "document_scan_records_fingerprint_idx" ON "document_scan_records"("tenant_id", "fingerprint") WHERE "status" = 'IMPORTED';

ALTER TABLE "document_scan_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_scan_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "document_scan_jobs"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
ALTER TABLE "document_scan_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_scan_pages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "document_scan_pages"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
ALTER TABLE "document_scan_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_scan_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "document_scan_records"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

COMMIT;
