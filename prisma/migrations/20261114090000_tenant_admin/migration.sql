-- SaaS phase 7C: pharmacy administration: account deletion requests, a ledger of manual subscription
-- changes, and authorised refunds. Additive; one transaction.
-- Rollback: prisma/rollbacks/20261114090000_tenant_admin/down.sql

BEGIN;

-- A pharmacy's Super Admin asks Web365 to close the account. Approval closes it (sign-in stops); the data is
-- kept until purge_after, and purging is a separate, explicit step.
CREATE TABLE "tenant_deletion_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "decided_by" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "purge_after" TIMESTAMPTZ(6),
    CONSTRAINT "tenant_deletion_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_deletion_requests_status_check" CHECK ("status" IN ('REQUESTED', 'CANCELLED', 'REJECTED', 'APPROVED')),
    CONSTRAINT "tenant_deletion_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "tenant_deletion_requests_tenant_idx" ON "tenant_deletion_requests"("tenant_id", "requested_at" DESC);
-- At most one open request per pharmacy.
CREATE UNIQUE INDEX "tenant_deletion_requests_open_key" ON "tenant_deletion_requests"("tenant_id") WHERE "status" = 'REQUESTED';

ALTER TABLE "tenants" ADD COLUMN "purge_after" TIMESTAMPTZ(6);

-- Every manual subscription change by Web365 staff, with the reason and the values before and after.
CREATE TABLE "subscription_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "subscription_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "subscription_adjustments_tenant_idx" ON "subscription_adjustments"("tenant_id", "at" DESC);

-- Refunds of subscription payments. Requested by one billing administrator, approved by another (unless the
-- policy allows one person), then sent to the payment provider; its status comes from the provider.
CREATE TABLE "billing_refunds" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requested_by" TEXT NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "decided_by" TEXT,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "provider_refund_id" TEXT,
    "provider_status" TEXT,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "billing_refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_refunds_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "billing_refunds_status_check" CHECK ("status" IN ('REQUESTED', 'REJECTED', 'PENDING', 'PROCESSED', 'FAILED')),
    CONSTRAINT "billing_refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "billing_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "billing_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "billing_refunds_payment_idx" ON "billing_refunds"("payment_id");
CREATE INDEX "billing_refunds_status_idx" ON "billing_refunds"("status", "requested_at" DESC);
CREATE UNIQUE INDEX "billing_refunds_provider_refund_id_key" ON "billing_refunds"("provider_refund_id");

-- An invoice records how much of it was refunded.
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_status_check";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_check" CHECK ("status" IN ('PAID', 'VOID', 'PARTIALLY_REFUNDED', 'REFUNDED'));

COMMIT;
