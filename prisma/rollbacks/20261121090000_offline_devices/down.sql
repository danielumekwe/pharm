-- Rolls back 20261121090000_offline_devices. Registered devices lose offline access (they must register again).
BEGIN;
DROP TABLE IF EXISTS "offline_devices";
COMMIT;
