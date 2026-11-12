-- Rolls back 20261124090000_ai_wallet. Refuses while any pharmacy holds paid coins (they would be lost).
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ai_coin_purchases" WHERE "status" = 'SUCCESS') THEN
    RAISE EXCEPTION 'Rollback refused: coins have been sold. Export the ledger and settle with pharmacies first.';
  END IF;
END $$;
DROP TABLE IF EXISTS "ai_reconciliation_runs";
DROP TABLE IF EXISTS "ai_usage_limits";
DROP TABLE IF EXISTS "ai_usage";
DROP TABLE IF EXISTS "ai_model_prices";
DROP TABLE IF EXISTS "ai_reservation_items";
DROP TABLE IF EXISTS "ai_reservations";
DROP TABLE IF EXISTS "ai_coin_purchases";
DROP TABLE IF EXISTS "ai_coin_packages";
DROP TABLE IF EXISTS "ai_operation_prices";
DROP TABLE IF EXISTS "ai_wallet_transactions";
DROP FUNCTION IF EXISTS "ai_ledger_immutable"();
DROP TABLE IF EXISTS "ai_wallets";
COMMIT;
