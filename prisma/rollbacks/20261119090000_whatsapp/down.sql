-- Rolls back 20261119090000_whatsapp. The WhatsApp message log, recipients (with consent records), pharmacy
-- preferences and templates are dropped: back them up first. The "whatsapp.zoho" platform setting is removed.

BEGIN;

DROP TABLE "whatsapp_messages";
DROP TABLE "whatsapp_recipients";
DROP TABLE "whatsapp_tenant_settings";
DROP TABLE "whatsapp_templates";
DELETE FROM "platform_settings" WHERE "key" = 'whatsapp.zoho';
DELETE FROM "platform_settings_history" WHERE "key" = 'whatsapp.zoho';
DELETE FROM "integration_checks" WHERE "integration" = 'whatsapp';
DELETE FROM "webhook_events" WHERE "provider" = 'zoho_whatsapp';

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119090000_whatsapp';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261119090000_whatsapp';
    END IF;
END $$;

COMMIT;
