-- Rolls back 20261120090000_inventory_imports. Products, batches and ledger rows created by imports stay
-- (they are ordinary inventory records); only the import history and staging data are dropped.

BEGIN;
DROP TABLE IF EXISTS "inventory_imports";
COMMIT;
