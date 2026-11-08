-- SaaS phase 7D: platform security: two-factor sign-in for Web365 staff, server-side sessions that can be
-- listed and revoked, and a log of every sign-in attempt (platform and pharmacy) for monitoring and lockout.
-- Additive; one transaction. Rollback: prisma/rollbacks/20261115090000_platform_security/down.sql

BEGIN;

-- Two-factor (TOTP authenticator app). The secret is AES-256-GCM ciphertext (SETTINGS_ENCRYPTION_KEY); recovery
-- codes are stored only as keyed hashes. totp_last_step stops a code from being used twice.
ALTER TABLE "platform_users"
    ADD COLUMN "totp_secret_ciphertext" TEXT,
    ADD COLUMN "totp_enabled_at" TIMESTAMPTZ(6),
    ADD COLUMN "totp_last_step" BIGINT,
    ADD COLUMN "recovery_codes" JSONB,
    -- Accounts created with a temporary password must choose their own at the first sign-in.
    ADD COLUMN "password_must_change" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "platform_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "two_factor" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_name" TEXT,
    "revoke_reason" TEXT,
    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "platform_sessions_user_idx" ON "platform_sessions"("user_id", "created_at" DESC);
CREATE INDEX "platform_sessions_active_idx" ON "platform_sessions"("revoked_at", "expires_at");

CREATE TABLE "sign_in_attempts" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "surface" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "user_id" TEXT,
    "tenant_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    CONSTRAINT "sign_in_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sign_in_attempts_surface_check" CHECK ("surface" IN ('platform', 'pharmacy')),
    CONSTRAINT "sign_in_attempts_outcome_check" CHECK ("outcome" IN ('success', 'two_factor_required', 'bad_password', 'two_factor_failed', 'locked', 'rate_limited', 'blocked_ip', 'refused'))
);
CREATE INDEX "sign_in_attempts_identifier_idx" ON "sign_in_attempts"("surface", "identifier", "at" DESC);
CREATE INDEX "sign_in_attempts_at_idx" ON "sign_in_attempts"("at" DESC);

COMMIT;
