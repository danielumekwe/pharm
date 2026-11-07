-- Rolls back 20261109090000_platform_admin. Run BEFORE the phase 3 rollback.
-- The platform audit trail and support grants are dropped: back them up first (npm run db:backup).

BEGIN;

DELETE FROM "auth_tokens" WHERE "purpose" = 'join_pharmacy';
ALTER TABLE "auth_tokens" DROP CONSTRAINT "auth_tokens_purpose_check";
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_purpose_check" CHECK ("purpose" IN ('verify_email', 'reset_password'));
ALTER TABLE "auth_tokens" DROP CONSTRAINT "auth_tokens_tenant_id_fkey";
ALTER TABLE "auth_tokens" DROP COLUMN "tenant_id";
ALTER TABLE "tenants" DROP COLUMN "status_changed_at";
ALTER TABLE "tenants" DROP COLUMN "status_reason";
DROP TABLE "support_access_grants";
DROP TABLE "platform_audit_events";
DROP TABLE "platform_users";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261109090000_platform_admin';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261109090000_platform_admin';
    END IF;
END $$;

COMMIT;
