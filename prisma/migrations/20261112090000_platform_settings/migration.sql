-- SaaS phase 7A: Platform Control Centre foundation.
-- Central platform settings (secrets stored only as AES-256-GCM ciphertext), their change history, user
-- preferences (the third settings level), integration check results, background job runs, and two more
-- platform roles. Additive; one transaction. Rollback: prisma/rollbacks/20261112090000_platform_settings/down.sql

BEGIN;

-- Platform-wide settings controlled by Web365. "value" never holds a secret; secrets live in
-- "secret_ciphertext" (encrypted with SETTINGS_ENCRYPTION_KEY, which only the server environment holds).
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "secret_ciphertext" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" TEXT,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- Who changed which setting, with secrets masked. Append-only for the application (see app-role.sql).
CREATE TABLE "platform_settings_history" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "changed_by" TEXT,
    "changed_by_name" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    CONSTRAINT "platform_settings_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_settings_history_key_idx" ON "platform_settings_history"("key", "changed_at" DESC);

-- Personal preferences (date format, language, …), per person and not per pharmacy.
CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Results of real connection checks (never assumed): the source of every "connected" status.
CREATE TABLE "integration_checks" (
    "id" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT NOT NULL,
    "checked_by" TEXT,
    CONSTRAINT "integration_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "integration_checks_integration_idx" ON "integration_checks"("integration", "checked_at" DESC);

-- One row per background job run across all pharmacies.
CREATE TABLE "platform_job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "finished_at" TIMESTAMPTZ(6),
    "pharmacies" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    CONSTRAINT "platform_job_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_job_runs_job_idx" ON "platform_job_runs"("job", "started_at" DESC);

-- Least-privilege roles for billing and technical staff.
ALTER TABLE "platform_users" DROP CONSTRAINT "platform_users_role_check";
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_role_check"
    CHECK ("role" IN ('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT', 'BILLING_ADMIN', 'TECHNICAL_ADMIN'));

COMMIT;
