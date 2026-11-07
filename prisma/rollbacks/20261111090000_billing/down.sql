-- Rolls back 20261111090000_billing. Run BEFORE the phase 5 rollback.
-- Refuses if any payment succeeded: invoices are financial records. Restore a backup instead.

BEGIN;

DO $$
DECLARE
    paid BIGINT;
BEGIN
    SELECT count(*) INTO paid FROM "billing_payments" WHERE "status" = 'SUCCESS';
    IF paid > 0 THEN
        RAISE EXCEPTION 'Rollback refused: % successful payments and their invoices exist. Restore the pre-migration backup instead.', paid;
    END IF;
END $$;

ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_scheduled_billing_cycle_check";
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_scheduled_plan_id_fkey";
ALTER TABLE "subscriptions" DROP COLUMN "cancel_at_period_end";
ALTER TABLE "subscriptions" DROP COLUMN "scheduled_billing_cycle";
ALTER TABLE "subscriptions" DROP COLUMN "scheduled_plan_id";
ALTER TABLE "subscriptions" DROP COLUMN "card_label";
ALTER TABLE "subscriptions" DROP COLUMN "authorization_code";
ALTER TABLE "subscriptions" DROP COLUMN "provider_customer_code";
ALTER TABLE "subscriptions" DROP COLUMN "provider";
DROP TABLE "webhook_events";
DROP TABLE "invoices";
DROP SEQUENCE "invoice_number_seq";
DROP TABLE "billing_payments";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111090000_billing';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261111090000_billing';
    END IF;
END $$;

COMMIT;
