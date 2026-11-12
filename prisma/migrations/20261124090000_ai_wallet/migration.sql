-- AI Wallet & Credit Management: one coin wallet per pharmacy, an append-only coin ledger, configurable
-- prices (versioned: a change never alters an operation already reserved or charged), coin packages sold
-- through Paystack, per-page reservations for AI work, provider usage and cost records, and spending limits.
-- Platform-level tables like billing_payments: every pharmacy-facing query filters on the signed-in
-- pharmacy's tenant_id (taken from the session), and the Control Centre reads across pharmacies.
-- Coin amounts are whole numbers; money uses NUMERIC.
-- Additive; one transaction. Rollback: prisma/rollbacks/20261124090000_ai_wallet/down.sql

BEGIN;

CREATE TABLE "ai_wallets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "purchased_total" INTEGER NOT NULL DEFAULT 0,
    "free_total" INTEGER NOT NULL DEFAULT 0,
    "consumed_total" INTEGER NOT NULL DEFAULT 0,
    "refunded_total" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    -- Lowest low-balance threshold already announced (reset when the balance rises again).
    "low_balance_notified" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_transaction_at" TIMESTAMPTZ(6),
    CONSTRAINT "ai_wallets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_wallets_tenant_key" UNIQUE ("tenant_id"),
    CONSTRAINT "ai_wallets_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "ai_wallets_nonnegative" CHECK ("available" >= 0 AND "reserved" >= 0),
    CONSTRAINT "ai_wallets_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED'))
);

-- The coin ledger. Rows are never changed or deleted (see trigger); corrections are new entries.
CREATE TABLE "ai_wallet_transactions" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL,
    "tenant_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    -- Effect on the two balances (available, reserved), so the ledger alone rebuilds the wallet.
    "available_delta" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL,
    "available_after" INTEGER NOT NULL,
    "reserved_after" INTEGER NOT NULL,
    "related_type" TEXT,
    "related_id" TEXT,
    "operation_code" TEXT,
    "description" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "ai_wallet_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_wallet_transactions_key" UNIQUE ("idempotency_key"),
    CONSTRAINT "ai_wallet_transactions_reference_key" UNIQUE ("reference"),
    CONSTRAINT "ai_wallet_transactions_wallet_fkey" FOREIGN KEY ("wallet_id") REFERENCES "ai_wallets"("id") ON DELETE CASCADE,
    CONSTRAINT "ai_wallet_transactions_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "ai_wallet_transactions_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "ai_wallet_transactions_after_check" CHECK ("available_after" >= 0 AND "reserved_after" >= 0),
    CONSTRAINT "ai_wallet_transactions_direction_check" CHECK ("direction" IN ('CREDIT', 'DEBIT', 'HOLD', 'RELEASE')),
    CONSTRAINT "ai_wallet_transactions_type_check" CHECK ("type" IN ('WELCOME_BONUS', 'PURCHASE', 'PROMO_BONUS', 'AI_USAGE', 'REFUND', 'RESERVATION', 'RESERVATION_RELEASE', 'ADJUSTMENT', 'PURCHASE_REVERSAL', 'EXPIRY'))
);
CREATE INDEX "ai_wallet_transactions_tenant_idx" ON "ai_wallet_transactions"("tenant_id", "seq" DESC);
CREATE INDEX "ai_wallet_transactions_wallet_idx" ON "ai_wallet_transactions"("wallet_id", "seq");
CREATE INDEX "ai_wallet_transactions_related_idx" ON "ai_wallet_transactions"("related_type", "related_id");
CREATE INDEX "ai_wallet_transactions_created_idx" ON "ai_wallet_transactions"("created_at");

CREATE FUNCTION "ai_ledger_immutable"() RETURNS trigger AS $$
BEGIN
  -- Deleting a whole pharmacy removes its ledger with it; nothing else may change or remove a row.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "tenants" WHERE "id" = OLD."tenant_id") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AI wallet transactions are immutable: record a correcting entry instead.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_wallet_transactions_immutable" BEFORE UPDATE OR DELETE ON "ai_wallet_transactions" FOR EACH ROW EXECUTE FUNCTION "ai_ledger_immutable"();

-- Prices per AI operation. Versioned: a change ends the current row and starts a new one, so reservations
-- and charges keep the price they were made with. tenant_id set = an override for one pharmacy.
CREATE TABLE "ai_operation_prices" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "effective_to" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "ai_operation_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_operation_prices_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "ai_operation_prices_method_check" CHECK ("method" IN ('FIXED', 'PER_PAGE', 'PER_DOCUMENT', 'PER_1K_TOKENS')),
    CONSTRAINT "ai_operation_prices_coins_check" CHECK ("coins" >= 0)
);
CREATE INDEX "ai_operation_prices_code_idx" ON "ai_operation_prices"("code", "tenant_id", "effective_from" DESC);
-- At most one current price per operation (and per pharmacy override).
CREATE UNIQUE INDEX "ai_operation_prices_current_key" ON "ai_operation_prices"("code", COALESCE("tenant_id", '')) WHERE "effective_to" IS NULL;

INSERT INTO "ai_operation_prices" ("id", "code", "name", "description", "method", "coins", "enabled", "created_by") VALUES
  ('aop-page-standard', 'document.page.standard', 'Standard document page', 'First page of a scanning job read by AI (printed or clear records).', 'PER_PAGE', 100, true, 'system'),
  ('aop-page-additional', 'document.page.additional', 'Additional document page', 'Each further page of the same scanning job.', 'PER_PAGE', 100, true, 'system'),
  ('aop-page-handwritten', 'document.page.handwritten', 'Complex handwritten page', 'A page the AI reports as mostly handwritten.', 'PER_PAGE', 150, true, 'system'),
  ('aop-page-failed', 'document.page.failed', 'Failed extraction (system or provider error)', 'Pages that could not be read are not charged.', 'PER_PAGE', 0, true, 'system'),
  ('aop-proofreading', 'document.proofreading', 'Manual proofreading and correction', 'Checking and correcting records is free.', 'FIXED', 0, true, 'system'),
  ('aop-stock-analysis', 'ai.stock-analysis', 'AI stock analysis', 'Reserved for a future AI service.', 'FIXED', 200, false, 'system'),
  ('aop-business-report', 'ai.business-report', 'AI business report', 'Reserved for a future AI service.', 'PER_1K_TOKENS', 10, false, 'system');

-- Coin packages sold through Paystack. Nothing is offered until a platform administrator activates a package.
CREATE TABLE "ai_coin_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "coins" INTEGER NOT NULL,
    "bonus_coins" INTEGER NOT NULL DEFAULT 0,
    "price" NUMERIC(14, 2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "promo_starts_at" TIMESTAMPTZ(6),
    "promo_ends_at" TIMESTAMPTZ(6),
    "max_per_tenant_per_month" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" TEXT,
    CONSTRAINT "ai_coin_packages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_coin_packages_values_check" CHECK ("coins" > 0 AND "bonus_coins" >= 0 AND "price" > 0)
);
INSERT INTO "ai_coin_packages" ("id", "name", "description", "coins", "bonus_coins", "price", "active", "display_order") VALUES
  ('acp-starter', 'Starter', 'About 5 pages', 500, 0, 2000, false, 1),
  ('acp-standard', 'Standard', 'About 15 pages', 1500, 0, 5000, false, 2),
  ('acp-business', 'Business', 'About 40 pages', 4000, 0, 12000, false, 3),
  ('acp-professional', 'Professional', 'About 100 pages', 10000, 0, 25000, false, 4);

CREATE TABLE "ai_coin_purchases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    -- The package as sold (later package edits do not change it).
    "package_name" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "bonus_coins" INTEGER NOT NULL,
    "amount" NUMERIC(14, 2) NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider_transaction_id" TEXT,
    "fees" NUMERIC(14, 2),
    "channel" TEXT,
    "failure_reason" TEXT,
    "settled_by" TEXT,
    "initiated_by" TEXT NOT NULL,
    "initiated_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "paid_at" TIMESTAMPTZ(6),
    "credited_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    CONSTRAINT "ai_coin_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_coin_purchases_reference_key" UNIQUE ("reference"),
    CONSTRAINT "ai_coin_purchases_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "ai_coin_purchases_status_check" CHECK ("status" IN ('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REFUNDED'))
);
CREATE INDEX "ai_coin_purchases_tenant_idx" ON "ai_coin_purchases"("tenant_id", "created_at" DESC);
CREATE INDEX "ai_coin_purchases_status_idx" ON "ai_coin_purchases"("status", "created_at");

-- Coins held for AI work. One item per page (or unit): each is charged or released exactly once.
CREATE TABLE "ai_reservations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "job_reference" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    -- Prices in force when the coins were reserved (operation code → coins, price row id).
    "prices" JSONB NOT NULL,
    "coins_reserved" INTEGER NOT NULL,
    "coins_charged" INTEGER NOT NULL DEFAULT 0,
    "coins_released" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "closed_at" TIMESTAMPTZ(6),
    CONSTRAINT "ai_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_reservations_key" UNIQUE ("idempotency_key"),
    CONSTRAINT "ai_reservations_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "ai_reservations_status_check" CHECK ("status" IN ('OPEN', 'CLOSED'))
);
CREATE INDEX "ai_reservations_tenant_idx" ON "ai_reservations"("tenant_id", "status");
CREATE INDEX "ai_reservations_job_idx" ON "ai_reservations"("job_id");

CREATE TABLE "ai_reservation_items" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "coins_reserved" INTEGER NOT NULL,
    "coins_charged" INTEGER NOT NULL DEFAULT 0,
    "operation_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "reason" TEXT,
    "settled_at" TIMESTAMPTZ(6),
    CONSTRAINT "ai_reservation_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_reservation_items_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ai_reservations"("id") ON DELETE CASCADE,
    CONSTRAINT "ai_reservation_items_unit_key" UNIQUE ("reservation_id", "unit_id"),
    CONSTRAINT "ai_reservation_items_status_check" CHECK ("status" IN ('HELD', 'CHARGED', 'RELEASED'))
);
CREATE INDEX "ai_reservation_items_unit_idx" ON "ai_reservation_items"("tenant_id", "unit_id", "status");

-- Provider model prices (USD per million tokens), versioned like operation prices.
CREATE TABLE "ai_model_prices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_per_mtok" NUMERIC(12, 6) NOT NULL,
    "output_per_mtok" NUMERIC(12, 6) NOT NULL,
    "cache_read_per_mtok" NUMERIC(12, 6) NOT NULL,
    "cache_write_per_mtok" NUMERIC(12, 6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL DEFAULT '',
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "effective_to" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,
    CONSTRAINT "ai_model_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_model_prices_current_key" ON "ai_model_prices"("provider", "model") WHERE "effective_to" IS NULL;
INSERT INTO "ai_model_prices" ("id", "provider", "model", "input_per_mtok", "output_per_mtok", "cache_read_per_mtok", "cache_write_per_mtok", "source", "created_by") VALUES
  ('amp-opus-5-5', 'anthropic', 'claude-opus-5-5', 4, 20, 0.20, 5, 'Anthropic list price, November 2026', 'system'),
  ('amp-sonnet-5-5', 'anthropic', 'claude-sonnet-5-5', 2, 10, 0.10, 2.50, 'Anthropic list price, November 2026', 'system'),
  ('amp-haiku-5-5', 'anthropic', 'claude-haiku-5-5', 0.10, 0.50, 0.01, 0.125, 'Anthropic list price, November 2026', 'system');

-- One row per AI provider request (no document content). Cost is estimated from the model price in force.
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "user_name" TEXT,
    "service" TEXT NOT NULL,
    "operation_code" TEXT,
    "job_id" TEXT,
    "job_reference" TEXT,
    "unit_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "request_id" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "cache_creation_tokens" INTEGER,
    "model_price_id" TEXT,
    "cost" NUMERIC(14, 6),
    "cost_currency" TEXT NOT NULL DEFAULT 'USD',
    -- estimated: tokens × configured model price. unavailable: the provider reported no usage.
    "cost_basis" TEXT NOT NULL,
    "duration_ms" INTEGER,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "coins_charged" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "ai_usage_status_check" CHECK ("status" IN ('SUCCESS', 'FAILED')),
    CONSTRAINT "ai_usage_basis_check" CHECK ("cost_basis" IN ('estimated', 'unavailable'))
);
CREATE INDEX "ai_usage_tenant_idx" ON "ai_usage"("tenant_id", "created_at" DESC);
CREATE INDEX "ai_usage_created_idx" ON "ai_usage"("created_at");
CREATE INDEX "ai_usage_job_idx" ON "ai_usage"("job_id");
CREATE INDEX "ai_usage_request_idx" ON "ai_usage"("request_id");

-- Spending and usage limits: one global row (tenant_id NULL) and optional per-pharmacy rows. NULL = no limit.
CREATE TABLE "ai_usage_limits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "max_daily_cost" NUMERIC(14, 4),
    "max_monthly_cost" NUMERIC(14, 4),
    "max_jobs_per_day" INTEGER,
    "max_pages_per_job" INTEGER,
    "max_concurrent_jobs" INTEGER,
    "max_requests_per_user_per_day" INTEGER,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "ai_usage_limits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_limits_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ai_usage_limits_scope_key" ON "ai_usage_limits"(COALESCE("tenant_id", ''));
INSERT INTO "ai_usage_limits" ("id", "tenant_id", "max_pages_per_job", "max_concurrent_jobs") VALUES ('aul-global', NULL, 60, 3);

-- Wallet reconciliation runs (ledger vs balances, stuck reservations, unsettled purchases).
CREATE TABLE "ai_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "finished_at" TIMESTAMPTZ(6),
    "wallets_checked" INTEGER NOT NULL DEFAULT 0,
    "mismatches" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "ai_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

COMMIT;
