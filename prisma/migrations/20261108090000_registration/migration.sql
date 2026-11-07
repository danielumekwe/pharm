-- SaaS phase 3: self-service registration and onboarding.
-- Adds subscription plans and per-pharmacy subscriptions (a trial for new pharmacies), single-use account
-- tokens (email verification, password reset), and account fields for verification and session revocation.
-- Additive; one transaction. Rollback script: prisma/rollbacks/20261108090000_registration/down.sql

BEGIN;

-- Accounts --------------------------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "email_verified_at" TEXT;
ALTER TABLE "users" ADD COLUMN "password_changed_at" TEXT;
-- Existing accounts were created by administrators of the pharmacy, so their emails count as confirmed.
UPDATE "users" SET "email_verified_at" = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

-- A retried registration (same request key) returns the pharmacy it already created.
ALTER TABLE "tenants" ADD COLUMN "registration_key" TEXT;
CREATE UNIQUE INDEX "tenants_registration_key_key" ON "tenants"("registration_key");

-- Single-use tokens: only a SHA-256 hash of each token is stored ---------------------------------------
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "auth_tokens_purpose_check" CHECK ("purpose" IN ('verify_email', 'reset_password'))
);
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX "auth_tokens_user_id_idx" ON "auth_tokens"("user_id");

-- Plans: editable by the platform (limits and features follow in phase 5) -------------------------------
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "monthly_price" DECIMAL(18,4),
    "annual_price" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plans_trial_days_check" CHECK ("trial_days" BETWEEN 0 AND 365)
);
-- Prices are left empty until Web365 sets them.
INSERT INTO "plans" ("id", "name", "description", "sort_order") VALUES
    ('starter', 'Starter', 'One outlet, three staff accounts, basic POS, products and inventory, sales history, basic reports.', 1),
    ('professional', 'Professional', 'Up to three outlets, ten staff accounts, full POS, stock transfers, batch and expiry management, advanced reports, email alerts.', 2),
    ('enterprise', 'Enterprise', 'Higher outlet and staff limits, central management, full regulatory management, advanced permissions, priority support.', 3);

-- One subscription per pharmacy -----------------------------------------------------------------------
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "billing_cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE', 'SUSPENDED', 'CANCELLED', 'EXPIRED')),
    CONSTRAINT "subscriptions_billing_cycle_check" CHECK ("billing_cycle" IN ('MONTHLY', 'ANNUAL'))
);
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- The demo pharmacy is complimentary: active on Enterprise with no billing period.
INSERT INTO "subscriptions" ("id", "tenant_id", "plan_id", "status", "billing_cycle")
SELECT 'sub-tenant-demo', "id", 'enterprise', 'ACTIVE', 'ANNUAL' FROM "tenants" WHERE "id" = 'tenant-demo';

COMMIT;
