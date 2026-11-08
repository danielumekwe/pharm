-- SaaS phase 7E: system configuration and backups. Records each database backup (taken with
-- scripts/db-backup.mjs, or noted from the hosting provider) so the Control Centre can show the backup history.
-- Additive; one transaction. Rollback: prisma/rollbacks/20261116090000_system/down.sql

BEGIN;

CREATE TABLE "platform_backups" (
    "id" TEXT NOT NULL,
    "taken_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tables" INTEGER,
    "rows" BIGINT,
    "size_bytes" BIGINT,
    "location" TEXT,
    "recorded_by" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "platform_backups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_backups_kind_check" CHECK ("kind" IN ('script', 'provider'))
);
CREATE INDEX "platform_backups_taken_at_idx" ON "platform_backups"("taken_at" DESC);

COMMIT;
