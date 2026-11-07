-- Rolls back 20261108090000_registration. Run BEFORE the phase 1 rollbacks.
-- Refuses if any pharmacy registered itself: their subscriptions and tokens would be lost.
-- In that case restore the pre-migration backup instead.

BEGIN;

DO $$
DECLARE
    registered BIGINT;
BEGIN
    SELECT count(*) INTO registered FROM "tenants" WHERE "registration_key" IS NOT NULL;
    IF registered > 0 THEN
        RAISE EXCEPTION 'Rollback refused: % self-registered pharmacies exist. Restore the pre-migration backup instead.', registered;
    END IF;
END $$;

DROP TABLE "subscriptions";
DROP TABLE "plans";
DROP TABLE "auth_tokens";
DROP INDEX "tenants_registration_key_key";
ALTER TABLE "tenants" DROP COLUMN "registration_key";
ALTER TABLE "users" DROP COLUMN "password_changed_at";
ALTER TABLE "users" DROP COLUMN "email_verified_at";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261108090000_registration';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261108090000_registration';
    END IF;
END $$;

COMMIT;
