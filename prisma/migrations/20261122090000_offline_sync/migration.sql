-- Offline synchronisation: every operation a device uploads is recorded here once, by the UUID the device
-- gave it, with its outcome. A repeated upload of the same operation returns the stored outcome instead of
-- applying it again (exactly-once). Conflicts (e.g. stock no longer available) are kept with their full
-- payload for the reconciliation centre; nothing is discarded.
-- Sales made offline carry their origin in sales.offline.
-- Additive; one transaction. Rollback: prisma/rollbacks/20261122090000_offline_sync/down.sql

BEGIN;

-- TEXT holding JSON, like the other JSON fields of the in-memory tables (lib/db/schema.ts).
ALTER TABLE "sales" ADD COLUMN "offline" TEXT;

CREATE TABLE "offline_operations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "local_reference" TEXT,
    "created_offline_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "message" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "resolution" TEXT,
    CONSTRAINT "offline_operations_pkey" PRIMARY KEY ("tenant_id", "id"),
    CONSTRAINT "offline_operations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "offline_operations_device_fkey" FOREIGN KEY ("device_id") REFERENCES "offline_devices"("id") ON DELETE RESTRICT,
    CONSTRAINT "offline_operations_status_check" CHECK ("status" IN ('APPLIED', 'CONFLICT', 'REJECTED', 'RESOLVED'))
);
CREATE INDEX "offline_operations_status_idx" ON "offline_operations"("tenant_id", "status", "received_at" DESC);
CREATE INDEX "offline_operations_device_idx" ON "offline_operations"("tenant_id", "device_id", "received_at" DESC);

ALTER TABLE "offline_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offline_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "offline_operations"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

COMMIT;
