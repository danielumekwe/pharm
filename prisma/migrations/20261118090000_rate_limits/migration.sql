-- Distributed API protection. Counters live in managed Redis; configuration and audit events live in PostgreSQL.
-- Rate limiting is disabled until Redis credentials are configured and a Platform Super Admin enables it.
-- Rollback: prisma/rollbacks/20261118090000_rate_limits/down.sql

BEGIN;

CREATE TABLE "platform_rate_limit_config" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" TEXT,
    CONSTRAINT "platform_rate_limit_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_rate_limit_config_singleton_check" CHECK ("id" = 'global')
);

INSERT INTO "platform_rate_limit_config" ("id", "enabled") VALUES ('global', false);

CREATE TABLE "platform_rate_limit_policies" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL DEFAULT 'global',
    "scope_value" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "requests_per_minute" INTEGER NOT NULL,
    "burst" INTEGER NOT NULL DEFAULT 0,
    "window_seconds" INTEGER NOT NULL DEFAULT 60,
    "block_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" TEXT,
    CONSTRAINT "platform_rate_limit_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_rate_limit_policies_scope_check" CHECK ("scope_type" IN ('global', 'tenant', 'user', 'ip', 'role', 'endpoint')),
    CONSTRAINT "platform_rate_limit_policies_values_check" CHECK (
        "requests_per_minute" BETWEEN 1 AND 100000
        AND "burst" BETWEEN 0 AND 100000
        AND "window_seconds" BETWEEN 1 AND 86400
        AND "block_seconds" BETWEEN 0 AND 86400
    ),
    CONSTRAINT "platform_rate_limit_policies_scope_value_check" CHECK (
        (("scope_type" = 'global' OR "scope_type" = 'ip') AND "scope_value" = '')
        OR ("scope_type" <> 'global' AND length("scope_value") BETWEEN 1 AND 240)
    ),
    CONSTRAINT "platform_rate_limit_policies_scope_key" UNIQUE ("category", "scope_type", "scope_value")
);
CREATE INDEX "platform_rate_limit_policies_category_idx" ON "platform_rate_limit_policies" ("category", "enabled");

INSERT INTO "platform_rate_limit_policies"
    ("id", "category", "label", "requests_per_minute", "burst")
VALUES
    ('rlp-api-general', 'api_general', 'General API requests', 180, 60),
    ('rlp-login', 'login', 'Login', 10, 2),
    ('rlp-registration', 'registration', 'Registration', 5, 2),
    ('rlp-password-reset', 'password_reset', 'Password reset', 5, 1),
    ('rlp-email-verification', 'email_verification', 'Email verification', 10, 2),
    ('rlp-otp-verification', 'otp_verification', 'OTP verification', 8, 2),
    ('rlp-pos-transactions', 'pos_transactions', 'POS transactions', 120, 30),
    ('rlp-product-search', 'product_search', 'Product searches', 120, 30),
    ('rlp-barcode-lookup', 'barcode_lookup', 'Barcode lookups', 120, 30),
    ('rlp-inventory-operations', 'inventory_operations', 'Inventory operations', 60, 15),
    ('rlp-stock-transfers', 'stock_transfers', 'Stock transfers', 30, 5),
    ('rlp-report-generation', 'report_generation', 'Report generation', 10, 2),
    ('rlp-file-uploads', 'file_uploads', 'File uploads', 20, 5),
    ('rlp-public-forms', 'public_forms', 'Public contact and demo forms', 5, 1);

INSERT INTO "platform_rate_limit_policies"
    ("id", "category", "label", "scope_type", "scope_value", "enabled", "requests_per_minute", "burst", "window_seconds", "block_seconds")
SELECT
    'rlp-ip-' || "category", "category", "label", 'ip', '', "enabled", "requests_per_minute", "burst", "window_seconds", "block_seconds"
FROM "platform_rate_limit_policies"
WHERE "scope_type" = 'global';

CREATE TABLE "platform_rate_limit_events" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "tenant_id" TEXT,
    "user_id" TEXT,
    "ip" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "limit_exceeded" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "event_type" TEXT NOT NULL DEFAULT 'rate_limited',
    "block_expires_at" TIMESTAMPTZ(6),
    CONSTRAINT "platform_rate_limit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_rate_limit_events_action_check" CHECK ("action" IN ('rate_limited', 'temporary_blocked', 'blocked_ip')),
    CONSTRAINT "platform_rate_limit_events_type_check" CHECK ("event_type" IN ('rate_limited', 'blocked_ip', 'automatic_block'))
);
CREATE INDEX "platform_rate_limit_events_at_idx" ON "platform_rate_limit_events" ("at" DESC);
CREATE INDEX "platform_rate_limit_events_tenant_idx" ON "platform_rate_limit_events" ("tenant_id", "at" DESC);
CREATE INDEX "platform_rate_limit_events_ip_idx" ON "platform_rate_limit_events" ("ip", "at" DESC);
CREATE INDEX "platform_rate_limit_events_endpoint_idx" ON "platform_rate_limit_events" ("endpoint", "at" DESC);

CREATE TABLE "platform_rate_limit_ip_rules" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_by" TEXT NOT NULL,
    CONSTRAINT "platform_rate_limit_ip_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_rate_limit_ip_rules_effect_check" CHECK ("effect" IN ('allow', 'block')),
    CONSTRAINT "platform_rate_limit_ip_rules_block_expiry_check" CHECK ("effect" = 'allow' OR "expires_at" IS NOT NULL),
    CONSTRAINT "platform_rate_limit_ip_rules_address_key" UNIQUE ("address", "effect")
);
CREATE INDEX "platform_rate_limit_ip_rules_expiry_idx" ON "platform_rate_limit_ip_rules" ("expires_at");

CREATE TABLE "platform_rate_limit_blocks" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_by" TEXT NOT NULL,
    CONSTRAINT "platform_rate_limit_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_rate_limit_blocks_ip_key" UNIQUE ("ip")
);
CREATE INDEX "platform_rate_limit_blocks_expiry_idx" ON "platform_rate_limit_blocks" ("expires_at");

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharm_app') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON "platform_rate_limit_events" FROM pharm_app;
    END IF;
END $$;

COMMIT;
