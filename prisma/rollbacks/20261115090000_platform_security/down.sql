-- Rolls back 20261115090000_platform_security. Run BEFORE the phase 7C rollback.
-- Two-factor enrolments, platform sessions and the sign-in log are dropped: back them up first. Everyone
-- signed in to the platform is signed out (old session cookies have no session row to match).

BEGIN;

DROP TABLE "sign_in_attempts";
DROP TABLE "platform_sessions";
ALTER TABLE "platform_users"
    DROP COLUMN "totp_secret_ciphertext",
    DROP COLUMN "totp_enabled_at",
    DROP COLUMN "totp_last_step",
    DROP COLUMN "recovery_codes",
    DROP COLUMN "password_must_change";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115090000_platform_security';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261115090000_platform_security';
    END IF;
END $$;

COMMIT;
