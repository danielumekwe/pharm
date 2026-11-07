-- Phase 1 of the multi-tenant SaaS conversion.
-- Adds tenants and tenant memberships, puts every existing record into the default demo tenant
-- ("tenant-demo"), and replaces global unique keys and foreign keys with tenant-scoped ones.
-- Additive: no rows are deleted and no IDs change. Runs as one transaction: if any check fails,
-- nothing is applied. Rollback script: prisma/rollbacks/20261107100000_tenants/down.sql

BEGIN;

-- 1. Tenants ---------------------------------------------------------------------------------------
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "business_email" TEXT,
    "business_phone" TEXT,
    "address" TEXT,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "state" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "time_zone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "owner_user_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenants_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- The existing pharmacy becomes the demo tenant; its name comes from the saved business settings.
INSERT INTO "tenants" ("id", "slug", "name", "is_demo", "owner_user_id")
SELECT 'tenant-demo', 'demo',
       COALESCE(NULLIF((SELECT "value"::json ->> 'businessName' FROM "app_state" WHERE "key" = 'settings'), ''), 'Web365 Demo Pharmacy'),
       true,
       (SELECT "id" FROM "users" WHERE "role" = 'SUPER_ADMIN' ORDER BY "seq" LIMIT 1);

-- 2. tenant_id on every tenant-owned table ------------------------------------------------------------
-- users and devices stay global (one account per person; tenant access comes from memberships).
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'outlets', 'user_outlets', 'products', 'product_packaging', 'product_barcodes', 'batches',
        'stock_movements', 'stock_ledger', 'price_history', 'held_sales', 'stock_transfers', 'customers',
        'suppliers', 'sales', 'sale_lines', 'purchase_orders', 'purchase_order_lines', 'payments', 'expenses',
        'audit_events', 'product_registrations', 'regulatory_documents', 'regulatory_files', 'inventory_alerts',
        'notifications', 'notification_deliveries', 'sale_returns', 'sale_return_lines',
        'impersonation_sessions', 'app_state'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN "tenant_id" TEXT', t);
        EXECUTE format('UPDATE %I SET "tenant_id" = %L', t, 'tenant-demo');
        EXECUTE format('ALTER TABLE %I ALTER COLUMN "tenant_id" SET NOT NULL', t);
        EXECUTE format('CREATE INDEX %I ON %I ("tenant_id")', t || '_tenant_id_idx', t);
        IF t <> 'app_state' THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE', t, t || '_tenant_id_fkey');
        END IF;
    END LOOP;
END $$;

-- app_state: platform-wide keys (the write lock, the seed marker) move to the reserved '_platform' scope;
-- settings, counters, job runs and the role matrix stay with the demo tenant.
UPDATE "app_state" SET "tenant_id" = '_platform' WHERE "key" IN ('__pharm_write_lock', 'seededAt');
ALTER TABLE "app_state" DROP CONSTRAINT "app_state_pkey";
ALTER TABLE "app_state" ADD CONSTRAINT "app_state_pkey" PRIMARY KEY ("tenant_id", "key");
ALTER TABLE "app_state" ADD CONSTRAINT "app_state_tenant_id_check"
    CHECK ("tenant_id" = '_platform' OR "tenant_id" <> '');

-- 3. Tenant memberships: a global user's role, status and permissions inside one tenant ----------------
CREATE TABLE "tenant_memberships" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "grants" TEXT,
    "default_outlet_id" TEXT,
    "staff_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_staff_id_key" ON "tenant_memberships"("tenant_id", "staff_id");
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

INSERT INTO "tenant_memberships" ("id", "tenant_id", "user_id", "role", "status", "grants", "default_outlet_id", "staff_id")
SELECT 'mem-tenant-demo-' || "id", 'tenant-demo', "id", "role", COALESCE("status", 'ACTIVE'), "grants", "outlet_id", "staff_id"
FROM "users";

-- A person can belong to several pharmacies, each with its own outlet list: the key includes the tenant.
ALTER TABLE "user_outlets" DROP CONSTRAINT "user_outlets_pkey";
ALTER TABLE "user_outlets" ADD CONSTRAINT "user_outlets_pkey" PRIMARY KEY ("tenant_id", "user_id", "position");

-- Staff IDs are per pharmacy now (unique per tenant, on the membership); emails stay globally unique.
DROP INDEX "users_staff_id_key";
CREATE INDEX "users_staff_id_idx" ON "users"("staff_id");

-- 4. Business codes and document numbers: unique per tenant instead of globally ------------------------
DROP INDEX "outlets_code_key";
CREATE UNIQUE INDEX "outlets_tenant_id_code_key" ON "outlets"("tenant_id", "code");
DROP INDEX "customers_code_key";
CREATE UNIQUE INDEX "customers_tenant_id_code_key" ON "customers"("tenant_id", "code");
DROP INDEX "suppliers_code_key";
CREATE UNIQUE INDEX "suppliers_tenant_id_code_key" ON "suppliers"("tenant_id", "code");
DROP INDEX "sales_number_key";
CREATE UNIQUE INDEX "sales_tenant_id_number_key" ON "sales"("tenant_id", "number");
DROP INDEX "purchase_orders_number_key";
CREATE UNIQUE INDEX "purchase_orders_tenant_id_number_key" ON "purchase_orders"("tenant_id", "number");
DROP INDEX "expenses_reference_key";
CREATE UNIQUE INDEX "expenses_tenant_id_reference_key" ON "expenses"("tenant_id", "reference");
DROP INDEX "product_registrations_product_name_key";
CREATE UNIQUE INDEX "product_registrations_tenant_id_product_name_key" ON "product_registrations"("tenant_id", "product_name");
DROP INDEX "sale_returns_number_key";
CREATE UNIQUE INDEX "sale_returns_tenant_id_number_key" ON "sale_returns"("tenant_id", "number");
DROP INDEX "stock_transfers_reference_key";
CREATE UNIQUE INDEX "stock_transfers_tenant_id_reference_key" ON "stock_transfers"("tenant_id", "reference");

-- 5. (tenant_id, id) keys, so links can name the tenant as well as the record --------------------------
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_id_key" UNIQUE ("tenant_id", "id");
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_id_key" UNIQUE ("tenant_id", "id");

-- 6. Line tables: the parent link now includes the tenant (replaces the id-only foreign keys) ----------
ALTER TABLE "product_packaging" DROP CONSTRAINT "product_packaging_product_id_fkey";
ALTER TABLE "product_packaging" ADD CONSTRAINT "product_packaging_product_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_barcodes" DROP CONSTRAINT "product_barcodes_product_id_fkey";
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_sale_id_fkey";
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_purchase_order_id_fkey";
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_return_lines" DROP CONSTRAINT "sale_return_lines_sale_return_id_fkey";
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_return_fkey" FOREIGN KEY ("tenant_id", "sale_return_id") REFERENCES "sale_returns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- user_outlets keeps its link to the (global) user and gains a tenant-checked link to the outlet.
ALTER TABLE "user_outlets" ADD CONSTRAINT "user_outlets_outlet_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_default_outlet_fkey" FOREIGN KEY ("tenant_id", "default_outlet_id") REFERENCES "outlets"("tenant_id", "id") DEFERRABLE INITIALLY DEFERRED;

-- 7. Cross-record links, checked at commit (rows are written table by table within a request) ----------
-- A NULL link is allowed (for example a batch with no supplier); a value must name a record of the same tenant.
DO $$
DECLARE
    link TEXT[];
BEGIN
    FOREACH link SLICE 1 IN ARRAY ARRAY[
        ['products', 'outlet_id', 'outlets'],
        ['products', 'supplier_id', 'suppliers'],
        ['batches', 'product_id', 'products'],
        ['batches', 'assigned_outlet_id', 'outlets'],
        ['batches', 'supplier_id', 'suppliers'],
        ['stock_movements', 'outlet_id', 'outlets'],
        ['stock_movements', 'to_outlet_id', 'outlets'],
        ['stock_movements', 'product_id', 'products'],
        ['stock_movements', 'batch_id', 'batches'],
        ['stock_ledger', 'product_id', 'products'],
        ['stock_ledger', 'outlet_id', 'outlets'],
        ['stock_ledger', 'batch_id', 'batches'],
        ['price_history', 'product_id', 'products'],
        ['price_history', 'outlet_id', 'outlets'],
        ['held_sales', 'outlet_id', 'outlets'],
        ['stock_transfers', 'from_outlet_id', 'outlets'],
        ['stock_transfers', 'to_outlet_id', 'outlets'],
        ['customers', 'outlet_id', 'outlets'],
        ['sales', 'outlet_id', 'outlets'],
        ['sales', 'customer_id', 'customers'],
        ['purchase_orders', 'supplier_id', 'suppliers'],
        ['purchase_orders', 'outlet_id', 'outlets'],
        ['expenses', 'outlet_id', 'outlets'],
        ['inventory_alerts', 'outlet_id', 'outlets'],
        ['inventory_alerts', 'product_id', 'products'],
        ['inventory_alerts', 'batch_id', 'batches'],
        ['sale_returns', 'sale_id', 'sales'],
        ['sale_returns', 'outlet_id', 'outlets']
    ] LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenant_id", %I) REFERENCES %I ("tenant_id", "id") DEFERRABLE INITIALLY DEFERRED',
            link[1], link[1] || '_' || link[2] || '_tenant_fkey', link[2], link[3]);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("tenant_id", %I)', link[1] || '_tenant_id_' || link[2] || '_idx', link[1], link[2]);
    END LOOP;
END $$;
SET CONSTRAINTS ALL IMMEDIATE; -- check the existing rows now, inside this migration

-- 8. Validation: stop (and roll back) if anything is left without a tenant or without its membership -----
DO $$
DECLARE
    t TEXT;
    missing BIGINT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'outlets', 'user_outlets', 'products', 'product_packaging', 'product_barcodes', 'batches',
        'stock_movements', 'stock_ledger', 'price_history', 'held_sales', 'stock_transfers', 'customers',
        'suppliers', 'sales', 'sale_lines', 'purchase_orders', 'purchase_order_lines', 'payments', 'expenses',
        'audit_events', 'product_registrations', 'regulatory_documents', 'regulatory_files', 'inventory_alerts',
        'notifications', 'notification_deliveries', 'sale_returns', 'sale_return_lines',
        'impersonation_sessions', 'app_state'
    ] LOOP
        EXECUTE format('SELECT count(*) FROM %I WHERE "tenant_id" IS NULL OR "tenant_id" = %L', t, '') INTO missing;
        IF missing > 0 THEN
            RAISE EXCEPTION 'Tenancy migration: % rows in % have no tenant', missing, t;
        END IF;
    END LOOP;
    SELECT count(*) INTO missing FROM "users" u
        WHERE NOT EXISTS (SELECT 1 FROM "tenant_memberships" m WHERE m."user_id" = u."id");
    IF missing > 0 THEN
        RAISE EXCEPTION 'Tenancy migration: % users have no tenant membership', missing;
    END IF;
    SELECT count(*) INTO missing FROM "user_outlets" uo
        WHERE NOT EXISTS (SELECT 1 FROM "tenant_memberships" m WHERE m."user_id" = uo."user_id" AND m."tenant_id" = uo."tenant_id");
    IF missing > 0 THEN
        RAISE EXCEPTION 'Tenancy migration: % outlet assignments belong to no membership', missing;
    END IF;
END $$;

COMMIT;
