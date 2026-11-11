-- Bulk product and opening-stock imports: staging (the uploaded rows, column mapping and preview), progress
-- of the confirmed import, what it created, and rollback. Stock itself is still created only through the
-- stock ledger (stock_ledger OPENING rows); this table never holds balances.
-- Additive; one transaction. Rollback: prisma/rollbacks/20261120090000_inventory_imports/down.sql

BEGIN;

CREATE TABLE "inventory_imports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL,
    "outlet_id" TEXT,
    -- Uploaded cells (headers, rows, spreadsheet row numbers). Kept so the preview can be rebuilt and rejected rows downloaded.
    "data" JSONB NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB,
    "edits" JSONB NOT NULL DEFAULT '{}',
    "decisions" JSONB NOT NULL DEFAULT '{}',
    -- The confirmed preview: per-row action and the chunks (whole product groups) it is committed in.
    "plan" JSONB,
    "plan_token" TEXT,
    "next_chunk" INTEGER NOT NULL DEFAULT 0,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '{}',
    -- Ids of the products, batches, ledger rows (and catalogue entries) this import created; rollback uses them.
    "created" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "rolled_back_at" TIMESTAMPTZ(6),
    "rolled_back_by" TEXT,
    "rollback_reason" TEXT,
    CONSTRAINT "inventory_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inventory_imports_outlet_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT "inventory_imports_kind_check" CHECK ("kind" IN ('catalogue', 'stock', 'both')),
    CONSTRAINT "inventory_imports_status_check" CHECK ("status" IN ('DRAFT', 'PREVIEWED', 'IN_PROGRESS', 'COMPLETED', 'ROLLED_BACK', 'CANCELLED'))
);
CREATE UNIQUE INDEX "inventory_imports_tenant_reference_key" ON "inventory_imports"("tenant_id", "reference");
CREATE INDEX "inventory_imports_tenant_created_idx" ON "inventory_imports"("tenant_id", "created_at" DESC);
-- Idempotency: the same file cannot be imported twice in the same way while an earlier import of it stands.
CREATE UNIQUE INDEX "inventory_imports_file_once_key" ON "inventory_imports"("tenant_id", "file_hash", "kind") WHERE "status" IN ('IN_PROGRESS', 'COMPLETED');

ALTER TABLE "inventory_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_imports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "inventory_imports"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

COMMIT;
