-- Rolls back 20261113090000_email. Run BEFORE the phase 7A rollback.
-- The email delivery log and any edited templates are dropped: back them up first.

BEGIN;

DROP TABLE "email_templates";
DROP TABLE "email_deliveries";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261113090000_email';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261113090000_email';
    END IF;
END $$;

COMMIT;
