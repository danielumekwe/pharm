-- SaaS phase 7F: support tickets between pharmacies and Web365, announcements to pharmacies (with read
-- receipts), and the knowledge base. Additive; one transaction.
-- Rollback: prisma/rollbacks/20261117090000_support/down.sql

BEGIN;

CREATE SEQUENCE "support_tickets_number_seq";

CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT nextval('support_tickets_number_seq'),
    "tenant_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_by_email" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assigned_to" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_reply_by" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_tickets_number_key" UNIQUE ("number"),
    CONSTRAINT "support_tickets_category_check" CHECK ("category" IN ('QUESTION', 'BUG', 'FEATURE', 'COMPLAINT', 'BILLING')),
    CONSTRAINT "support_tickets_status_check" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')),
    CONSTRAINT "support_tickets_priority_check" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    CONSTRAINT "support_tickets_last_reply_check" CHECK ("last_reply_by" IS NULL OR "last_reply_by" IN ('pharmacy', 'platform')),
    CONSTRAINT "support_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
ALTER SEQUENCE "support_tickets_number_seq" OWNED BY "support_tickets"."number";
CREATE INDEX "support_tickets_tenant_idx" ON "support_tickets"("tenant_id", "updated_at" DESC);
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status", "updated_at" DESC);

-- Messages on a ticket. Internal notes are Web365-only and never shown to the pharmacy.
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_messages_author_check" CHECK ("author_type" IN ('pharmacy', 'platform')),
    CONSTRAINT "support_messages_internal_check" CHECK (NOT "internal" OR "author_type" = 'platform'),
    CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "support_messages_ticket_idx" ON "support_messages"("ticket_id", "created_at");

-- Announcements from Web365. audience: {"type":"all"} | {"type":"plans","ids":[...]} |
-- {"type":"statuses","ids":[...]} (subscription statuses) | {"type":"tenants","ids":[...]}.
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "audience" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "email_owners" BOOLEAN NOT NULL DEFAULT false,
    "emailed_at" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "published_at" TIMESTAMPTZ(6),
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcements_severity_check" CHECK ("severity" IN ('info', 'warning', 'critical')),
    CONSTRAINT "announcements_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))
);
CREATE INDEX "announcements_status_idx" ON "announcements"("status", "starts_at");

CREATE TABLE "announcement_reads" (
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcement_id", "user_id", "tenant_id"),
    CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "kb_articles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" TEXT,
    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_articles_slug_key" UNIQUE ("slug")
);

COMMIT;
