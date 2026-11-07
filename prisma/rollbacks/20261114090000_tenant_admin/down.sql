-- Rolls back 20261114090000_tenant_admin. Run BEFORE the phase 7B rollback.
-- Deletion requests, the subscription adjustment ledger and refund records are dropped: back them up first.
-- Pharmacies closed through a deletion request stay CLOSED (only the purge date column goes).

BEGIN;

-- Refunded invoices go back to PAID (the refund records themselves are dropped below).
UPDATE "invoices" SET "status" = 'PAID' WHERE "status" IN ('PARTIALLY_REFUNDED', 'REFUNDED');
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_status_check";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_check" CHECK ("status" IN ('PAID', 'VOID'));

DROP TABLE "billing_refunds";
DROP TABLE "subscription_adjustments";
DROP TABLE "tenant_deletion_requests";
ALTER TABLE "tenants" DROP COLUMN "purge_after";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114090000_tenant_admin';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261114090000_tenant_admin';
    END IF;
END $$;

COMMIT;
