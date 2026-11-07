-- Rolls back SaaS phase 5 plan limits and feature entitlements.
BEGIN;

ALTER TABLE "plans"
    DROP CONSTRAINT "plans_max_outlets_check",
    DROP CONSTRAINT "plans_max_staff_accounts_check",
    DROP CONSTRAINT "plans_features_array_check",
    DROP COLUMN "max_outlets",
    DROP COLUMN "max_staff_accounts",
    DROP COLUMN "features";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261110090000_plan_limits';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261110090000_plan_limits';
    END IF;
END $$;

COMMIT;
