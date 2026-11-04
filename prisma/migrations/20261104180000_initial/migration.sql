-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT,
    "address" TEXT,
    "manager" TEXT,
    "phone" TEXT,
    "pcn_license" TEXT,
    "licence_expiry" TEXT,
    "status" TEXT,
    "stock_value" DOUBLE PRECISION,
    "sales" DOUBLE PRECISION,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password" TEXT,
    "password_hash" TEXT,
    "role" TEXT NOT NULL,
    "outlet_id" TEXT,
    "status" TEXT,
    "grants" TEXT,
    "last_login" TEXT,
    "created_at" TEXT,
    "invite" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_outlets" (
    "user_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "outlet_id" TEXT NOT NULL,

    CONSTRAINT "user_outlets_pkey" PRIMARY KEY ("user_id","position")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "generic_name" TEXT,
    "category" TEXT,
    "manufacturer" TEXT,
    "strength" TEXT,
    "uom" TEXT,
    "purchase_price" DOUBLE PRECISION,
    "selling_price" DOUBLE PRECISION,
    "min_stock" INTEGER,
    "max_stock" INTEGER,
    "stock" INTEGER,
    "status" TEXT,
    "barcode" TEXT,
    "nafdac_number" TEXT,
    "outlet_id" TEXT NOT NULL,
    "expiry_window" TEXT,
    "rx_only" BOOLEAN,
    "controlled" BOOLEAN,
    "threshold_source" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT,
    "supplier" TEXT,
    "assigned_outlet_id" TEXT NOT NULL,
    "receiving_date" TEXT,
    "manufacturing_date" TEXT,
    "expiry_date" TEXT NOT NULL,
    "quantity_received" INTEGER,
    "available_quantity" INTEGER,
    "purchase_price" DOUBLE PRECISION,
    "disposition" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "date" TEXT,
    "type" TEXT,
    "outlet_id" TEXT,
    "to_outlet_id" TEXT,
    "product_name" TEXT,
    "quantity" INTEGER,
    "status" TEXT,
    "batch_id" TEXT,
    "disposition" TEXT,
    "reason" TEXT,
    "requested_by" TEXT,
    "approved_by" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "outlet_id" TEXT,
    "credit_limit" DOUBLE PRECISION,
    "balance" DOUBLE PRECISION,
    "status" TEXT,
    "created_at" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "pcn_license" TEXT,
    "payment_terms_days" INTEGER,
    "balance" DOUBLE PRECISION,
    "status" TEXT,
    "categories" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "date" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "customer_name" TEXT,
    "cashier" TEXT,
    "cashier_id" TEXT,
    "subtotal" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "vat" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "amount_paid" DOUBLE PRECISION,
    "payment_method" TEXT,
    "status" TEXT,
    "prescription_ref" TEXT,
    "void_reason" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "sale_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT,
    "batch_numbers" TEXT,
    "quantity" INTEGER,
    "unit_price" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("sale_id","position")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "supplier_id" TEXT,
    "supplier_name" TEXT,
    "outlet_id" TEXT,
    "created_at" TEXT,
    "expected_date" TEXT,
    "created_by" TEXT,
    "created_by_id" TEXT,
    "approved_by" TEXT,
    "status" TEXT,
    "total" DOUBLE PRECISION,
    "amount_paid" DOUBLE PRECISION,
    "notes" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "purchase_order_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT,
    "quantity" INTEGER,
    "unit_cost" DOUBLE PRECISION,
    "received_quantity" INTEGER,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("purchase_order_id","position")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "date" TEXT,
    "direction" TEXT,
    "party_type" TEXT,
    "party_id" TEXT,
    "party_name" TEXT,
    "document_ref" TEXT,
    "method" TEXT,
    "account" TEXT,
    "amount" DOUBLE PRECISION,
    "recorded_by" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "date" TEXT,
    "category" TEXT,
    "description" TEXT,
    "vendor" TEXT,
    "outlet_id" TEXT,
    "amount" DOUBLE PRECISION,
    "status" TEXT,
    "requested_by" TEXT,
    "requested_by_id" TEXT,
    "approved_by" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT,
    "actor_role" TEXT,
    "action" TEXT,
    "entity" TEXT,
    "entity_id" TEXT,
    "summary" TEXT,
    "outlet_id" TEXT,
    "severity" TEXT,
    "impersonation_id" TEXT,
    "impersonator_id" TEXT,
    "impersonator_name" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_registrations" (
    "id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "generic_name" TEXT,
    "manufacturer" TEXT,
    "category" TEXT,
    "nafdac_number" TEXT,
    "issued_date" TEXT,
    "expiry_date" TEXT,
    "notes" TEXT,
    "updated_by" TEXT,
    "updated_at" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "product_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "category" TEXT,
    "related_to" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "size" INTEGER,
    "stored_name" TEXT,
    "expires_on" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "regulatory_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_alerts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT,
    "severity" TEXT,
    "status" TEXT,
    "outlet_id" TEXT,
    "product_id" TEXT,
    "product_name" TEXT,
    "batch_id" TEXT,
    "batch_number" TEXT,
    "snapshot" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,
    "resolved_manually" BOOLEAN,
    "cleared_at" TEXT,
    "notified" TEXT,
    "history" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "inventory_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alert_id" TEXT,
    "title" TEXT,
    "body" TEXT,
    "severity" TEXT,
    "link" TEXT,
    "created_at" TEXT,
    "read_at" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "at" TEXT,
    "channel" TEXT,
    "recipient_id" TEXT,
    "recipient_name" TEXT,
    "recipient_email" TEXT,
    "subject" TEXT,
    "event" TEXT,
    "alert_id" TEXT,
    "status" TEXT,
    "detail" TEXT,
    "attempts" INTEGER,
    "next_attempt_at" TEXT,
    "payload" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "sale_id" TEXT NOT NULL,
    "sale_number" TEXT,
    "outlet_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "processed_by" TEXT,
    "processed_by_id" TEXT,
    "cashier" TEXT,
    "cashier_id" TEXT,
    "net" DOUBLE PRECISION,
    "vat" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "refund_method" TEXT,
    "refunded_amount" DOUBLE PRECISION,
    "credited_amount" DOUBLE PRECISION,
    "reason" TEXT,
    "restocked" BOOLEAN,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_lines" (
    "sale_return_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT,
    "quantity" INTEGER,
    "unit_net" DOUBLE PRECISION,
    "net" DOUBLE PRECISION,
    "vat" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,

    CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY ("sale_return_id","position")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "admin_name" TEXT,
    "target_id" TEXT NOT NULL,
    "target_name" TEXT,
    "target_role" TEXT,
    "target_staff_id" TEXT,
    "reason" TEXT,
    "started_at" TEXT NOT NULL,
    "expires_at" TEXT,
    "ended_at" TEXT,
    "end_reason" TEXT,
    "actions" INTEGER,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "token" TEXT,
    "platform" TEXT,
    "label" TEXT,
    "registered_at" TEXT,
    "last_seen_at" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_state" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "app_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "outlets_code_key" ON "outlets"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_staff_id_key" ON "users"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_outlet_id_idx" ON "users"("outlet_id");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_outlet_id_idx" ON "products"("outlet_id");

-- CreateIndex
CREATE INDEX "batches_batch_number_idx" ON "batches"("batch_number");

-- CreateIndex
CREATE INDEX "batches_product_id_idx" ON "batches"("product_id");

-- CreateIndex
CREATE INDEX "batches_assigned_outlet_id_idx" ON "batches"("assigned_outlet_id");

-- CreateIndex
CREATE INDEX "batches_expiry_date_idx" ON "batches"("expiry_date");

-- CreateIndex
CREATE INDEX "stock_movements_date_idx" ON "stock_movements"("date");

-- CreateIndex
CREATE INDEX "stock_movements_outlet_id_idx" ON "stock_movements"("outlet_id");

-- CreateIndex
CREATE INDEX "stock_movements_status_idx" ON "stock_movements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_number_key" ON "sales"("number");

-- CreateIndex
CREATE INDEX "sales_date_idx" ON "sales"("date");

-- CreateIndex
CREATE INDEX "sales_outlet_id_idx" ON "sales"("outlet_id");

-- CreateIndex
CREATE INDEX "sales_customer_id_idx" ON "sales"("customer_id");

-- CreateIndex
CREATE INDEX "sales_cashier_id_idx" ON "sales"("cashier_id");

-- CreateIndex
CREATE INDEX "sales_status_idx" ON "sales"("status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_outlet_id_idx" ON "purchase_orders"("outlet_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "payments_date_idx" ON "payments"("date");

-- CreateIndex
CREATE INDEX "payments_party_id_idx" ON "payments"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_reference_key" ON "expenses"("reference");

-- CreateIndex
CREATE INDEX "expenses_outlet_id_idx" ON "expenses"("outlet_id");

-- CreateIndex
CREATE INDEX "audit_events_at_idx" ON "audit_events"("at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- CreateIndex
CREATE INDEX "audit_events_impersonation_id_idx" ON "audit_events"("impersonation_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_registrations_product_name_key" ON "product_registrations"("product_name");

-- CreateIndex
CREATE INDEX "inventory_alerts_key_idx" ON "inventory_alerts"("key");

-- CreateIndex
CREATE INDEX "inventory_alerts_status_idx" ON "inventory_alerts"("status");

-- CreateIndex
CREATE INDEX "inventory_alerts_outlet_id_idx" ON "inventory_alerts"("outlet_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_recipient_id_idx" ON "notification_deliveries"("recipient_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_event_idx" ON "notification_deliveries"("event");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_number_key" ON "sale_returns"("number");

-- CreateIndex
CREATE INDEX "sale_returns_sale_id_idx" ON "sale_returns"("sale_id");

-- CreateIndex
CREATE INDEX "sale_returns_outlet_id_idx" ON "sale_returns"("outlet_id");

-- CreateIndex
CREATE INDEX "sale_returns_date_idx" ON "sale_returns"("date");

-- CreateIndex
CREATE INDEX "impersonation_sessions_admin_id_idx" ON "impersonation_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "impersonation_sessions_target_id_idx" ON "impersonation_sessions"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_token_key" ON "devices"("token");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- AddForeignKey
ALTER TABLE "user_outlets" ADD CONSTRAINT "user_outlets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
