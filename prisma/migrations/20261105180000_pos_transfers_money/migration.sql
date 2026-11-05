-- POS (split payments, held sales), explicit stock transfers, receiving references, and exact money columns.
-- Additive except for money columns, which change from DOUBLE PRECISION to NUMERIC(18,4) with their values kept.

-- Money: exact decimals.
ALTER TABLE "outlets" ALTER COLUMN "stock_value" TYPE NUMERIC(18,4) USING "stock_value"::NUMERIC(18,4);
ALTER TABLE "outlets" ALTER COLUMN "sales" TYPE NUMERIC(18,4) USING "sales"::NUMERIC(18,4);
ALTER TABLE "products" ALTER COLUMN "purchase_price" TYPE NUMERIC(18,4) USING "purchase_price"::NUMERIC(18,4);
ALTER TABLE "products" ALTER COLUMN "selling_price" TYPE NUMERIC(18,4) USING "selling_price"::NUMERIC(18,4);
ALTER TABLE "products" ALTER COLUMN "wholesale_price" TYPE NUMERIC(18,4) USING "wholesale_price"::NUMERIC(18,4);
ALTER TABLE "products" ALTER COLUMN "min_selling_price" TYPE NUMERIC(18,4) USING "min_selling_price"::NUMERIC(18,4);
ALTER TABLE "product_packaging" ALTER COLUMN "purchase_price" TYPE NUMERIC(18,4) USING "purchase_price"::NUMERIC(18,4);
ALTER TABLE "product_packaging" ALTER COLUMN "selling_price" TYPE NUMERIC(18,4) USING "selling_price"::NUMERIC(18,4);
ALTER TABLE "product_packaging" ALTER COLUMN "wholesale_price" TYPE NUMERIC(18,4) USING "wholesale_price"::NUMERIC(18,4);
ALTER TABLE "product_packaging" ALTER COLUMN "min_selling_price" TYPE NUMERIC(18,4) USING "min_selling_price"::NUMERIC(18,4);
ALTER TABLE "batches" ALTER COLUMN "purchase_price" TYPE NUMERIC(18,4) USING "purchase_price"::NUMERIC(18,4);
ALTER TABLE "stock_ledger" ALTER COLUMN "unit_cost" TYPE NUMERIC(18,4) USING "unit_cost"::NUMERIC(18,4);
ALTER TABLE "price_history" ALTER COLUMN "old_value" TYPE NUMERIC(18,4) USING "old_value"::NUMERIC(18,4);
ALTER TABLE "price_history" ALTER COLUMN "new_value" TYPE NUMERIC(18,4) USING "new_value"::NUMERIC(18,4);
ALTER TABLE "customers" ALTER COLUMN "credit_limit" TYPE NUMERIC(18,4) USING "credit_limit"::NUMERIC(18,4);
ALTER TABLE "customers" ALTER COLUMN "balance" TYPE NUMERIC(18,4) USING "balance"::NUMERIC(18,4);
ALTER TABLE "suppliers" ALTER COLUMN "balance" TYPE NUMERIC(18,4) USING "balance"::NUMERIC(18,4);
ALTER TABLE "sales" ALTER COLUMN "subtotal" TYPE NUMERIC(18,4) USING "subtotal"::NUMERIC(18,4);
ALTER TABLE "sales" ALTER COLUMN "discount" TYPE NUMERIC(18,4) USING "discount"::NUMERIC(18,4);
ALTER TABLE "sales" ALTER COLUMN "vat" TYPE NUMERIC(18,4) USING "vat"::NUMERIC(18,4);
ALTER TABLE "sales" ALTER COLUMN "total" TYPE NUMERIC(18,4) USING "total"::NUMERIC(18,4);
ALTER TABLE "sales" ALTER COLUMN "amount_paid" TYPE NUMERIC(18,4) USING "amount_paid"::NUMERIC(18,4);
ALTER TABLE "sale_lines" ALTER COLUMN "unit_price" TYPE NUMERIC(18,4) USING "unit_price"::NUMERIC(18,4);
ALTER TABLE "sale_lines" ALTER COLUMN "discount" TYPE NUMERIC(18,4) USING "discount"::NUMERIC(18,4);
ALTER TABLE "sale_lines" ALTER COLUMN "total" TYPE NUMERIC(18,4) USING "total"::NUMERIC(18,4);
ALTER TABLE "sale_lines" ALTER COLUMN "pack_price" TYPE NUMERIC(18,4) USING "pack_price"::NUMERIC(18,4);
ALTER TABLE "purchase_orders" ALTER COLUMN "total" TYPE NUMERIC(18,4) USING "total"::NUMERIC(18,4);
ALTER TABLE "purchase_orders" ALTER COLUMN "amount_paid" TYPE NUMERIC(18,4) USING "amount_paid"::NUMERIC(18,4);
ALTER TABLE "purchase_order_lines" ALTER COLUMN "unit_cost" TYPE NUMERIC(18,4) USING "unit_cost"::NUMERIC(18,4);
ALTER TABLE "payments" ALTER COLUMN "amount" TYPE NUMERIC(18,4) USING "amount"::NUMERIC(18,4);
ALTER TABLE "expenses" ALTER COLUMN "amount" TYPE NUMERIC(18,4) USING "amount"::NUMERIC(18,4);
ALTER TABLE "sale_returns" ALTER COLUMN "net" TYPE NUMERIC(18,4) USING "net"::NUMERIC(18,4);
ALTER TABLE "sale_returns" ALTER COLUMN "vat" TYPE NUMERIC(18,4) USING "vat"::NUMERIC(18,4);
ALTER TABLE "sale_returns" ALTER COLUMN "total" TYPE NUMERIC(18,4) USING "total"::NUMERIC(18,4);
ALTER TABLE "sale_returns" ALTER COLUMN "refunded_amount" TYPE NUMERIC(18,4) USING "refunded_amount"::NUMERIC(18,4);
ALTER TABLE "sale_returns" ALTER COLUMN "credited_amount" TYPE NUMERIC(18,4) USING "credited_amount"::NUMERIC(18,4);
ALTER TABLE "sale_return_lines" ALTER COLUMN "unit_net" TYPE NUMERIC(18,4) USING "unit_net"::NUMERIC(18,4);
ALTER TABLE "sale_return_lines" ALTER COLUMN "net" TYPE NUMERIC(18,4) USING "net"::NUMERIC(18,4);
ALTER TABLE "sale_return_lines" ALTER COLUMN "vat" TYPE NUMERIC(18,4) USING "vat"::NUMERIC(18,4);
ALTER TABLE "sale_return_lines" ALTER COLUMN "total" TYPE NUMERIC(18,4) USING "total"::NUMERIC(18,4);

-- Sales: tender split, cash change, transaction discount and walk-in details.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "payments" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "tendered" NUMERIC(18,4);
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "change" NUMERIC(18,4);
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "global_discount" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "discount_authorised_by" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "walk_in" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "customer_kind" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "held_id" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "receipt_prints" INTEGER;

-- Product code / SKU.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sku" TEXT;
CREATE INDEX IF NOT EXISTS "products_sku_idx" ON "products"("sku");

-- Goods receipts: supplier invoice and purchase reference.
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "invoice_number" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "purchase_reference" TEXT;

-- Held / draft POS baskets (no stock moves until completed).
CREATE TABLE IF NOT EXISTS "held_sales" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "cashier_id" TEXT,
    "cashier_name" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,
    "label" TEXT,
    "cart" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "held_sales_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "held_sales_outlet_id_idx" ON "held_sales"("outlet_id");
CREATE INDEX IF NOT EXISTS "held_sales_cashier_id_idx" ON "held_sales"("cashier_id");

-- Inter-outlet transfers: request, approval, dispatch and receipt.
CREATE TABLE IF NOT EXISTS "stock_transfers" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "from_outlet_id" TEXT NOT NULL,
    "to_outlet_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lines" TEXT,
    "notes" TEXT,
    "created_at" TEXT,
    "created_by" TEXT,
    "created_by_id" TEXT,
    "approved_by" TEXT,
    "dispatched_at" TEXT,
    "dispatched_by" TEXT,
    "received_at" TEXT,
    "received_by" TEXT,
    "discrepancies" TEXT,
    "history" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "stock_transfers_reference_key" ON "stock_transfers"("reference");
CREATE INDEX IF NOT EXISTS "stock_transfers_from_outlet_id_idx" ON "stock_transfers"("from_outlet_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_to_outlet_id_idx" ON "stock_transfers"("to_outlet_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_status_idx" ON "stock_transfers"("status");
