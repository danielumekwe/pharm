-- WhatsApp notifications through Zoho CPaaS: templates, per-pharmacy recipients and preferences, and the
-- message queue/log. The Zoho connection itself is a platform setting ("whatsapp.zoho", encrypted secrets).
-- Additive; one transaction. Rollback: prisma/rollbacks/20261119090000_whatsapp/down.sql

BEGIN;

-- Templates as approved in Zoho CPaaS / Meta. A template is used only when Web365 has marked it APPROVED
-- (after checking it in Zoho) and it is active. A template Zoho refuses (WA_103) is marked REJECTED.
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "template_key" TEXT,
    "template_alias" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'UTILITY',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "status_note" TEXT,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" TEXT,
    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_templates_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED')),
    CONSTRAINT "whatsapp_templates_category_check" CHECK ("category" IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
    CONSTRAINT "whatsapp_templates_reference_check" CHECK (("template_key" IS NULL) <> ("template_alias" IS NULL))
);
CREATE INDEX "whatsapp_templates_type_idx" ON "whatsapp_templates"("notification_type");

-- Each pharmacy's own choices. Read and written only for the signed-in pharmacy (and by background jobs).
CREATE TABLE "whatsapp_tenant_settings" (
    "tenant_id" TEXT NOT NULL,
    "daily_report_channel" TEXT NOT NULL DEFAULT 'email',
    "types" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" TEXT,
    CONSTRAINT "whatsapp_tenant_settings_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "whatsapp_tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "whatsapp_tenant_settings_channel_check" CHECK ("daily_report_channel" IN ('email', 'whatsapp', 'both'))
);

-- People a pharmacy has authorised to receive WhatsApp messages, with their consent and any opt-out.
CREATE TABLE "whatsapp_recipients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "types" JSONB NOT NULL DEFAULT '[]',
    "outlet_id" TEXT,
    "consent_at" TIMESTAMPTZ(6) NOT NULL,
    "consent_by" TEXT NOT NULL,
    "consent_note" TEXT,
    "opted_out_at" TIMESTAMPTZ(6),
    "opt_out_source" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "whatsapp_recipients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "whatsapp_recipients_tenant_phone_key" ON "whatsapp_recipients"("tenant_id", "phone");

-- Every WhatsApp message: queued by events and jobs, sent by the background queue, updated by webhooks.
-- dedupe_key stops the same notification being queued twice. Template values are kept encrypted, and only
-- until the message is accepted or given up.
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "tenant_id" TEXT,
    "recipient_id" TEXT,
    "recipient_phone" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "template_id" TEXT,
    "template_name" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "values_ciphertext" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "claimed_at" TIMESTAMPTZ(6),
    "provider_message_id" TEXT,
    "provider_request_id" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_by" TEXT,
    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_messages_status_check" CHECK ("status" IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'UNDELIVERED', 'FAILED', 'SKIPPED'))
);
CREATE UNIQUE INDEX "whatsapp_messages_dedupe_key" ON "whatsapp_messages"("dedupe_key");
CREATE INDEX "whatsapp_messages_queue_idx" ON "whatsapp_messages"("status", "next_attempt_at");
CREATE INDEX "whatsapp_messages_tenant_idx" ON "whatsapp_messages"("tenant_id", "created_at" DESC);
CREATE INDEX "whatsapp_messages_provider_idx" ON "whatsapp_messages"("provider_message_id");
CREATE INDEX "whatsapp_messages_created_idx" ON "whatsapp_messages"("created_at" DESC);

COMMIT;
