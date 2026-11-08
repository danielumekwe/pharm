-- Restricted role for the application (SaaS phase 2). Run once per database by its owner:
--   psql "$DIRECT_DATABASE_URL" -f prisma/sql/app-role.sql
-- Then set DATABASE_APP_ROLE=pharm_app for the app. Every app transaction runs SET LOCAL ROLE pharm_app,
-- so Row Level Security applies even when the connection logs in as the table owner (owners and roles with
-- BYPASSRLS would otherwise skip it). pharm_app cannot create, alter or drop tables.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharm_app') THEN
        CREATE ROLE pharm_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO pharm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pharm_app;
-- Tables added by later migrations (run by the owner) get the same rights.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pharm_app;
-- Sequences (invoice numbers).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pharm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pharm_app;
-- The login role may switch to pharm_app (needed on PostgreSQL 16+, where creating a role does not grant it).
GRANT pharm_app TO CURRENT_USER;

-- The platform audit trail is append-only for the application.
DO $$
BEGIN
    IF to_regclass('platform_audit_events') IS NOT NULL THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON "platform_audit_events" FROM pharm_app;
    END IF;
END $$;

-- Financial records and the webhook log are append-only for the application (no deleting history).
DO $$
BEGIN
    IF to_regclass('invoices') IS NOT NULL THEN
        REVOKE DELETE, TRUNCATE ON "invoices", "billing_payments", "webhook_events" FROM pharm_app;
    END IF;
END $$;

-- Settings change history is append-only for the application.
DO $$
BEGIN
    IF to_regclass('platform_settings_history') IS NOT NULL THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON "platform_settings_history" FROM pharm_app;
    END IF;
END $$;

-- The email delivery log keeps its history (status updates for retries only).
DO $$
BEGIN
    IF to_regclass('email_deliveries') IS NOT NULL THEN
        REVOKE DELETE, TRUNCATE ON "email_deliveries" FROM pharm_app;
    END IF;
END $$;

-- Pharmacy administration records keep their history: refunds and deletion requests change status only,
-- and the subscription adjustment ledger is append-only.
DO $$
BEGIN
    IF to_regclass('billing_refunds') IS NOT NULL THEN
        REVOKE DELETE, TRUNCATE ON "billing_refunds", "tenant_deletion_requests" FROM pharm_app;
        REVOKE UPDATE, DELETE, TRUNCATE ON "subscription_adjustments" FROM pharm_app;
    END IF;
END $$;

-- The sign-in log is append-only for the application; platform sessions are revoked, never deleted.
DO $$
BEGIN
    IF to_regclass('sign_in_attempts') IS NOT NULL THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON "sign_in_attempts" FROM pharm_app;
        REVOKE DELETE, TRUNCATE ON "platform_sessions" FROM pharm_app;
    END IF;
END $$;
