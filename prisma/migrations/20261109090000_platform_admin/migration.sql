-- SaaS phase 4: platform administration, separate from pharmacy administration.
-- Web365 staff get their own accounts (platform_users) and an append-only audit trail. Platform staff have
-- no access to pharmacy records; a pharmacy's Super Admin can approve time-limited, read-only support access
-- (support_access_grants). Tokens gain a tenant for "join a pharmacy" invitations to existing accounts.
-- Additive; one transaction. Rollback script: prisma/rollbacks/20261109090000_platform_admin/down.sql

BEGIN;

CREATE TABLE "platform_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_users_role_check" CHECK ("role" IN ('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT')),
    CONSTRAINT "platform_users_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED')),
    CONSTRAINT "platform_users_email_lower_check" CHECK ("email" = lower("email"))
);
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- Who did what on the platform. The app role may only add and read rows (see prisma/sql/app-role.sql).
CREATE TABLE "platform_audit_events" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "tenant_id" TEXT,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "ip" TEXT,
    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_audit_events_actor_type_check" CHECK ("actor_type" IN ('platform', 'pharmacy', 'system')),
    CONSTRAINT "platform_audit_events_severity_check" CHECK ("severity" IN ('info', 'warning', 'critical'))
);
CREATE INDEX "platform_audit_events_at_idx" ON "platform_audit_events"("at" DESC);
CREATE INDEX "platform_audit_events_tenant_id_idx" ON "platform_audit_events"("tenant_id");

-- Support access: requested by Web365, approved (or denied, revoked) by the pharmacy's Super Admin.
CREATE TABLE "support_access_grants" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "decided_by" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_access_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "support_access_grants_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "support_access_grants_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'DENIED', 'REVOKED')),
    CONSTRAINT "support_access_grants_duration_check" CHECK ("duration_minutes" BETWEEN 15 AND 480)
);
CREATE INDEX "support_access_grants_tenant_id_idx" ON "support_access_grants"("tenant_id");

-- Pharmacy suspensions carry a reason, shown to the pharmacy's users and in the platform.
ALTER TABLE "tenants" ADD COLUMN "status_reason" TEXT;
ALTER TABLE "tenants" ADD COLUMN "status_changed_at" TIMESTAMPTZ(6);

-- "Join this pharmacy" invitations for people who already have an account.
ALTER TABLE "auth_tokens" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_tokens" DROP CONSTRAINT "auth_tokens_purpose_check";
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_purpose_check" CHECK ("purpose" IN ('verify_email', 'reset_password', 'join_pharmacy'));

COMMIT;
