-- Advanced product registration and stock ledger. Additive only: existing rows and columns are untouched.

-- Product master: classification, lifecycle, base unit and extra pricing.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_type" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "dosage_form" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "size" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "supplier_id" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lifecycle" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "base_unit" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "wholesale_price" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "min_selling_price" DOUBLE PRECISION;

-- Packaging levels per product (largest first; the last row is the base unit).
CREATE TABLE IF NOT EXISTS "product_packaging" (
    "product_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "id" TEXT,
    "name" TEXT,
    "contains" INTEGER,
    "units_per_package" INTEGER,
    "is_base" BOOLEAN,
    "purchase_price" DOUBLE PRECISION,
    "selling_price" DOUBLE PRECISION,
    "wholesale_price" DOUBLE PRECISION,
    "min_selling_price" DOUBLE PRECISION,
    "sellable" BOOLEAN,

    CONSTRAINT "product_packaging_pkey" PRIMARY KEY ("product_id","position"),
    CONSTRAINT "product_packaging_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Barcodes per product and packaging level (manufacturer or internal).
CREATE TABLE IF NOT EXISTS "product_barcodes" (
    "product_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT,
    "format" TEXT,
    "source" TEXT,
    "packaging_id" TEXT,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("product_id","position"),
    CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Batch traceability.
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "supplier_id" TEXT;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "supplier_batch_ref" TEXT;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "regulatory_number" TEXT;

-- Approval workflow records now point at the item by id.
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "product_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "direction" TEXT;
CREATE INDEX IF NOT EXISTS "stock_movements_product_id_idx" ON "stock_movements"("product_id");

-- Sales by packaging level, with the exact batches drawn.
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "packaging_name" TEXT;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "units_per_package" INTEGER;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "pack_quantity" DOUBLE PRECISION;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "pack_price" DOUBLE PRECISION;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "allocations" TEXT;

-- Regulatory register.
ALTER TABLE "product_registrations" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "product_registrations" ADD COLUMN IF NOT EXISTS "renewal_date" TEXT;
ALTER TABLE "product_registrations" ADD COLUMN IF NOT EXISTS "local_representative" TEXT;

-- Append-only stock ledger: every balance is the sum of these rows.
CREATE TABLE IF NOT EXISTS "stock_ledger" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT,
    "outlet_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "batch_number" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "units_per_unit" INTEGER,
    "base_quantity" INTEGER NOT NULL,
    "previous_balance" INTEGER,
    "new_balance" INTEGER,
    "batch_balance" INTEGER,
    "unit_cost" DOUBLE PRECISION,
    "user_id" TEXT,
    "user_name" TEXT,
    "remarks" TEXT,
    "movement_id" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "stock_ledger_reference_idx" ON "stock_ledger"("reference");
CREATE INDEX IF NOT EXISTS "stock_ledger_at_idx" ON "stock_ledger"("at");
CREATE INDEX IF NOT EXISTS "stock_ledger_type_idx" ON "stock_ledger"("type");
CREATE INDEX IF NOT EXISTS "stock_ledger_product_id_idx" ON "stock_ledger"("product_id");
CREATE INDEX IF NOT EXISTS "stock_ledger_outlet_id_idx" ON "stock_ledger"("outlet_id");
CREATE INDEX IF NOT EXISTS "stock_ledger_batch_id_idx" ON "stock_ledger"("batch_id");

-- Price history: old transactions keep the prices they were made at.
CREATE TABLE IF NOT EXISTS "price_history" (
    "id" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT,
    "outlet_id" TEXT,
    "level" TEXT,
    "kind" TEXT,
    "old_value" DOUBLE PRECISION,
    "new_value" DOUBLE PRECISION,
    "user_id" TEXT,
    "user_name" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "price_history_product_id_idx" ON "price_history"("product_id");
