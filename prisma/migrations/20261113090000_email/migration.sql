-- SaaS phase 7B: platform email: delivery log with retry queue, and editable email templates.
-- Additive; one transaction. Rollback: prisma/rollbacks/20261113090000_email/down.sql

BEGIN;

-- Every email the platform sends. Message bodies are kept only for retryable platform emails, and only
-- encrypted (they can contain one-time links); pharmacy alert emails are logged without their subject.
CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "category" TEXT NOT NULL,
    "template" TEXT,
    "tenant_id" TEXT,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "body_ciphertext" TEXT,
    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_deliveries_status_check" CHECK ("status" IN ('SENT', 'FAILED', 'RETRYING', 'SKIPPED')),
    CONSTRAINT "email_deliveries_category_check" CHECK ("category" IN ('account', 'billing', 'platform', 'test', 'pharmacy'))
);
CREATE INDEX "email_deliveries_created_at_idx" ON "email_deliveries"("created_at" DESC);
CREATE INDEX "email_deliveries_retry_idx" ON "email_deliveries"("status", "next_attempt_at");

-- Templates edited by Web365; defaults live in code until a template is saved here.
CREATE TABLE "email_templates" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" TEXT,
    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("key")
);

COMMIT;
