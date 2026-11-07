-- Rolls back 20261112090000_platform_settings. Run BEFORE the phase 6 rollback.
-- Saved platform settings (including encrypted keys) and their history are dropped: back up first.
-- Refuses while staff hold the new roles.

BEGIN;

DO $$
DECLARE
    holders BIGINT;
BEGIN
    SELECT count(*) INTO holders FROM "platform_users" WHERE "role" IN ('BILLING_ADMIN', 'TECHNICAL_ADMIN');
    IF holders > 0 THEN
        RAISE EXCEPTION 'Rollback refused: % platform accounts hold the Billing or Technical Administrator role. Change their role first.', holders;
    END IF;
END $$;

ALTER TABLE "platform_users" DROP CONSTRAINT "platform_users_role_check";
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_role_check" CHECK ("role" IN ('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT'));
DROP TABLE "platform_job_runs";
DROP TABLE "integration_checks";
DROP TABLE "user_preferences";
DROP TABLE "platform_settings_history";
DROP TABLE "platform_settings";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112090000_platform_settings';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261112090000_platform_settings';
    END IF;
END $$;

COMMIT;
