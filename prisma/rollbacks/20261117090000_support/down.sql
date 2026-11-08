-- Rolls back 20261117090000_support. Run BEFORE the phase 7E rollback.
-- Support tickets and their messages, announcements and knowledge base articles are dropped: back them up first.

BEGIN;

DROP TABLE "kb_articles";
DROP TABLE "announcement_reads";
DROP TABLE "announcements";
DROP TABLE "support_messages";
DROP TABLE "support_tickets";

DO $$
BEGIN
    IF to_regclass('_prisma_migrations') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261117090000_support';
    END IF;
    IF to_regclass('_local_migrations') IS NOT NULL THEN
        DELETE FROM "_local_migrations" WHERE "name" = '20261117090000_support';
    END IF;
END $$;

COMMIT;
