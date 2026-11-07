-- Rolls back 20261107100100_tenant_rls: removes the Row Level Security policies. Data is untouched.
-- Run BEFORE rolling back 20261107100000_tenants. See docs/tenancy-migration.md.

BEGIN;

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
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation" ON %I', t);
        EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- Forget the migration so `prisma migrate deploy` can apply it again later.
DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261107100100_tenant_rls';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261107100100_tenant_rls';
    END IF;
END $$;

COMMIT;
