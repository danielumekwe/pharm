-- Rolls back 20261122090000_offline_sync. Refuses while offline conflicts are unresolved (they hold sales not yet posted).
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "offline_operations" WHERE "status" = 'CONFLICT') THEN
    RAISE EXCEPTION 'Rollback refused: unresolved offline conflicts exist.';
  END IF;
END $$;
DROP TABLE IF EXISTS "offline_operations";
ALTER TABLE "sales" DROP COLUMN IF EXISTS "offline";
COMMIT;
