-- SaaS phase 6: subscription payments (Paystack first; provider-neutral tables), invoices and webhook log.
-- Additive; one transaction. Rollback script: prisma/rollbacks/20261111090000_billing/down.sql

BEGIN;

-- One row per payment attempt. The amount is always worked out on the server from the plan's price.
CREATE TABLE "billing_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "billing_cycle" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "initiated_by" TEXT,
    "initiated_by_name" TEXT,
    "provider_transaction_id" TEXT,
    "channel" TEXT,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "settled_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "billing_payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "billing_payments_purpose_check" CHECK ("purpose" IN ('START', 'RENEWAL', 'UPGRADE')),
    CONSTRAINT "billing_payments_cycle_check" CHECK ("billing_cycle" IN ('MONTHLY', 'ANNUAL')),
    CONSTRAINT "billing_payments_status_check" CHECK ("status" IN ('PENDING', 'SUCCESS', 'FAILED', 'ABANDONED')),
    CONSTRAINT "billing_payments_amount_check" CHECK ("amount" > 0 AND "credit" >= 0)
);
CREATE UNIQUE INDEX "billing_payments_reference_key" ON "billing_payments"("reference");
CREATE INDEX "billing_payments_tenant_id_idx" ON "billing_payments"("tenant_id");
CREATE INDEX "billing_payments_status_idx" ON "billing_payments"("status");

-- Invoices for successful payments, numbered across the platform (W365-2026-000001).
CREATE SEQUENCE "invoice_number_seq";
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "billing_cycle" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "bill_to" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "billing_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invoices_status_check" CHECK ("status" IN ('PAID', 'VOID'))
);
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE UNIQUE INDEX "invoices_payment_id_key" ON "invoices"("payment_id");
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");

-- Every webhook received, once: the unique key makes a repeated delivery a no-op.
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "reference" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "processed_at" TIMESTAMPTZ(6),
    "result" TEXT,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_events_provider_event_key_key" ON "webhook_events"("provider", "event_key");

-- Subscription billing details: saved card (for later automatic renewal), scheduled changes, cancellation.
ALTER TABLE "subscriptions" ADD COLUMN "provider" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "provider_customer_code" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "authorization_code" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "card_label" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_plan_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_billing_cycle" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_plan_id_fkey" FOREIGN KEY ("scheduled_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_billing_cycle_check" CHECK ("scheduled_billing_cycle" IS NULL OR "scheduled_billing_cycle" IN ('MONTHLY', 'ANNUAL'));

COMMIT;
