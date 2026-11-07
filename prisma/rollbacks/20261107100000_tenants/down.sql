-- Rolls back 20261107100000_tenants: returns the schema to its pre-tenancy shape (global unique keys,
-- id-only foreign keys, no tenant columns). Run AFTER rolling back 20261107100100_tenant_rls, and only
-- together with the pre-Phase-1 application code. See docs/tenancy-migration.md.
--
-- Refuses to run if any tenant other than the demo tenant has data: dropping tenant_id would merge
-- separate pharmacies into one. In that case restore the pre-migration backup instead.

BEGIN;

DO $$
DECLARE
    others BIGINT;
BEGIN
    SELECT count(*) INTO others FROM "tenants" WHERE "id" <> 'tenant-demo';
    IF others > 0 THEN
        RAISE EXCEPTION 'Rollback refused: % tenants besides tenant-demo exist. Restore the pre-migration backup instead.', others;
    END IF;
    SELECT count(*) INTO others FROM "tenant_memberships" WHERE "tenant_id" <> 'tenant-demo';
    IF others > 0 THEN
        RAISE EXCEPTION 'Rollback refused: memberships outside tenant-demo exist.';
    END IF;
END $$;

-- Since phase 2 the membership is where role, status, permission grants, default outlet and staff ID are
-- kept; copy them back to the user rows the pre-tenancy code reads.
UPDATE "users" u
SET "role" = m."role", "status" = m."status", "grants" = m."grants", "outlet_id" = m."default_outlet_id", "staff_id" = m."staff_id"
FROM "tenant_memberships" m
WHERE m."user_id" = u."id" AND m."tenant_id" = 'tenant-demo';

-- 7. Cross-record links
DO $$
DECLARE
    link TEXT[];
BEGIN
    FOREACH link SLICE 1 IN ARRAY ARRAY[
        ['products', 'outlet_id'], ['products', 'supplier_id'], ['batches', 'product_id'],
        ['batches', 'assigned_outlet_id'], ['batches', 'supplier_id'], ['stock_movements', 'outlet_id'],
        ['stock_movements', 'to_outlet_id'], ['stock_movements', 'product_id'], ['stock_movements', 'batch_id'],
        ['stock_ledger', 'product_id'], ['stock_ledger', 'outlet_id'], ['stock_ledger', 'batch_id'],
        ['price_history', 'product_id'], ['price_history', 'outlet_id'], ['held_sales', 'outlet_id'],
        ['stock_transfers', 'from_outlet_id'], ['stock_transfers', 'to_outlet_id'], ['customers', 'outlet_id'],
        ['sales', 'outlet_id'], ['sales', 'customer_id'], ['purchase_orders', 'supplier_id'],
        ['purchase_orders', 'outlet_id'], ['expenses', 'outlet_id'], ['inventory_alerts', 'outlet_id'],
        ['inventory_alerts', 'product_id'], ['inventory_alerts', 'batch_id'], ['sale_returns', 'sale_id'],
        ['sale_returns', 'outlet_id']
    ] LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', link[1], link[1] || '_' || link[2] || '_tenant_fkey');
        EXECUTE format('DROP INDEX IF EXISTS %I', link[1] || '_tenant_id_' || link[2] || '_idx');
    END LOOP;
END $$;

-- 6. Line tables: back to id-only parent links
ALTER TABLE "user_outlets" DROP CONSTRAINT "user_outlets_outlet_fkey";
ALTER TABLE "tenant_memberships" DROP CONSTRAINT "tenant_memberships_default_outlet_fkey";
ALTER TABLE "product_packaging" DROP CONSTRAINT "product_packaging_product_fkey";
ALTER TABLE "product_packaging" ADD CONSTRAINT "product_packaging_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_barcodes" DROP CONSTRAINT "product_barcodes_product_fkey";
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_sale_fkey";
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_purchase_order_fkey";
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_return_lines" DROP CONSTRAINT "sale_return_lines_sale_return_fkey";
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. (tenant_id, id) keys
ALTER TABLE "outlets" DROP CONSTRAINT "outlets_tenant_id_id_key";
ALTER TABLE "products" DROP CONSTRAINT "products_tenant_id_id_key";
ALTER TABLE "batches" DROP CONSTRAINT "batches_tenant_id_id_key";
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_tenant_id_id_key";
ALTER TABLE "customers" DROP CONSTRAINT "customers_tenant_id_id_key";
ALTER TABLE "sales" DROP CONSTRAINT "sales_tenant_id_id_key";
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_tenant_id_id_key";
ALTER TABLE "sale_returns" DROP CONSTRAINT "sale_returns_tenant_id_id_key";

-- 4. Global unique keys again
DROP INDEX "outlets_tenant_id_code_key";
CREATE UNIQUE INDEX "outlets_code_key" ON "outlets"("code");
DROP INDEX "customers_tenant_id_code_key";
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");
DROP INDEX "suppliers_tenant_id_code_key";
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");
DROP INDEX "sales_tenant_id_number_key";
CREATE UNIQUE INDEX "sales_number_key" ON "sales"("number");
DROP INDEX "purchase_orders_tenant_id_number_key";
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");
DROP INDEX "expenses_tenant_id_reference_key";
CREATE UNIQUE INDEX "expenses_reference_key" ON "expenses"("reference");
DROP INDEX "product_registrations_tenant_id_product_name_key";
CREATE UNIQUE INDEX "product_registrations_product_name_key" ON "product_registrations"("product_name");
DROP INDEX "sale_returns_tenant_id_number_key";
CREATE UNIQUE INDEX "sale_returns_number_key" ON "sale_returns"("number");
DROP INDEX "stock_transfers_tenant_id_reference_key";
CREATE UNIQUE INDEX "stock_transfers_reference_key" ON "stock_transfers"("reference");

-- 3. Memberships, outlet assignments and global staff IDs
ALTER TABLE "user_outlets" DROP CONSTRAINT "user_outlets_pkey";
ALTER TABLE "user_outlets" ADD CONSTRAINT "user_outlets_pkey" PRIMARY KEY ("user_id", "position");
DROP INDEX "users_staff_id_idx";
CREATE UNIQUE INDEX "users_staff_id_key" ON "users"("staff_id");
DROP TABLE "tenant_memberships";

-- 2. app_state back to one row per key, then drop every tenant_id column
ALTER TABLE "app_state" DROP CONSTRAINT "app_state_tenant_id_check";
ALTER TABLE "app_state" DROP CONSTRAINT "app_state_pkey";
ALTER TABLE "app_state" ADD CONSTRAINT "app_state_pkey" PRIMARY KEY ("key");

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
        EXECUTE format('ALTER TABLE %I DROP COLUMN "tenant_id"', t); -- also drops its index and foreign key
    END LOOP;
END $$;

-- 1. Tenants
DROP TABLE "tenants";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261107100000_tenants';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261107100000_tenants';
    END IF;
END $$;

COMMIT;
