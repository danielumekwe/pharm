-- SaaS phase 5: configurable plan limits and feature entitlements, with enforcement in the application.
-- Prices stay unset until provided by Web365. Enterprise capacity is also left unset until specified.
-- Additive; rollback: prisma/rollbacks/20261110090000_plan_limits/down.sql

BEGIN;

ALTER TABLE "plans" ADD COLUMN "max_outlets" INTEGER;
ALTER TABLE "plans" ADD COLUMN "max_staff_accounts" INTEGER;
ALTER TABLE "plans" ADD COLUMN "features" JSONB;

UPDATE "plans" SET "max_outlets" = 1, "max_staff_accounts" = 3 WHERE "id" = 'starter';
UPDATE "plans" SET "max_outlets" = 3, "max_staff_accounts" = 10 WHERE "id" = 'professional';

ALTER TABLE "plans"
    ADD CONSTRAINT "plans_max_outlets_check" CHECK ("max_outlets" IS NULL OR "max_outlets" >= 1),
    ADD CONSTRAINT "plans_max_staff_accounts_check" CHECK ("max_staff_accounts" IS NULL OR "max_staff_accounts" >= 1),
    ADD CONSTRAINT "plans_features_array_check" CHECK ("features" IS NULL OR jsonb_typeof("features") = 'array');

COMMIT;
