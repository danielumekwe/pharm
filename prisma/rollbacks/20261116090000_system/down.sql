-- Rolls back 20261116090000_system. Run BEFORE the phase 7D rollback. The backup history list is dropped
-- (the backup files themselves are not touched).

BEGIN;

DROP TABLE "platform_backups";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261116090000_system';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261116090000_system';
    END IF;
END $$;

COMMIT;
