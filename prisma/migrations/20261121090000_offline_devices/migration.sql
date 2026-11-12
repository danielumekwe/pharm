-- Devices registered for offline use of the installed app (PWA / Android). Each device belongs to one
-- pharmacy, one user and one outlet. The device proves itself by signing requests with a private key that never
-- leaves it (non-extractable WebCrypto key); only the public key is stored. Offline access always expires (offline_valid_until), because a disconnected device cannot be told
-- it was revoked until it reconnects.
-- Additive; one transaction. Rollback: prisma/rollbacks/20261121090000_offline_devices/down.sql

BEGIN;

CREATE TABLE "offline_devices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "user_agent" TEXT,
    "public_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "registered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_seen_at" TIMESTAMPTZ(6),
    "last_package_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "offline_valid_until" TIMESTAMPTZ(6),
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "local_counts" JSONB NOT NULL DEFAULT '{}',
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" TEXT,
    "revoke_reason" TEXT,
    CONSTRAINT "offline_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offline_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "offline_devices_outlet_fkey" FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlets"("tenant_id", "id") DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT "offline_devices_status_check" CHECK ("status" IN ('ACTIVE', 'REVOKED'))
);
CREATE INDEX "offline_devices_tenant_idx" ON "offline_devices"("tenant_id", "registered_at" DESC);
CREATE INDEX "offline_devices_user_idx" ON "offline_devices"("tenant_id", "user_id");

ALTER TABLE "offline_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offline_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "offline_devices"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

COMMIT;
