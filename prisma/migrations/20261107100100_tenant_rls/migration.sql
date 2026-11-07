-- Phase 1 of the multi-tenant SaaS conversion: PostgreSQL Row Level Security as a second barrier.
-- Each tenant table only shows and accepts rows whose tenant_id equals the transaction setting
-- app.tenant_id, which the application sets at the start of every transaction (SET LOCAL semantics).
-- With no setting, tenant tables show nothing. FORCE applies the policies to the table owner too.
-- Superusers and roles with BYPASSRLS are not affected: the application must not connect as one.
-- Rollback script: prisma/rollbacks/20261107100100_tenant_rls/down.sql

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
        'impersonation_sessions'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY "tenant_isolation" ON %I USING ("tenant_id" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenant_id" = current_setting(''app.tenant_id'', true))',
            t);
    END LOOP;
END $$;

-- app_state also holds the platform-wide rows (write lock, seed marker), readable from any tenant.
ALTER TABLE "app_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "app_state"
    USING ("tenant_id" = current_setting('app.tenant_id', true) OR "tenant_id" = '_platform')
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true) OR "tenant_id" = '_platform');

COMMIT;
