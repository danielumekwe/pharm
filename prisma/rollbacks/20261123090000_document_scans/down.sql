-- Rolls back 20261123090000_document_scans. Refuses while migrated historical sales exist (they would lose their marker).
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "sales" WHERE "migrated" IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback refused: migrated historical sales exist.';
  END IF;
END $$;
DROP TABLE IF EXISTS "document_scan_records";
DROP TABLE IF EXISTS "document_scan_pages";
DROP TABLE IF EXISTS "document_scan_jobs";
ALTER TABLE "sales" DROP COLUMN IF EXISTS "migrated";
COMMIT;
