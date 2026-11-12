// Database schema: single source of truth for the PostgreSQL tables and generated Prisma schema.
// Pure data (no imports) so scripts can load it directly with Node.

/** "money" is stored as NUMERIC(18,4) so amounts are exact; "real" is for non-monetary measurements. */
export type FieldKind = "text" | "int" | "real" | "money" | "bool" | "json";
/**
 * `unique` is per tenant on tenant tables. `ref` names the table this field points at; the database checks
 * the link together with tenant_id (composite foreign key), so a record cannot point into another tenant.
 */
export type FieldSpec = readonly [field: string, kind: FieldKind, options?: { required?: boolean; unique?: boolean; index?: boolean; ref?: string }];

export type ChildSpec = {
  table: string;
  /** Property on the parent holding the child array. */
  property: string;
  parentColumn: string;
  /** Child arrays of plain strings (e.g. user outlet ids) are stored in this single column. */
  scalarColumn?: string;
  fields?: readonly FieldSpec[];
};

export type TableSpec = {
  table: string;
  /** Where the collection lives in memory: a data-module slot or an ERP store property. */
  source: { kind: "data"; key: string } | { kind: "store"; key: string };
  /** Newest-first lists are reloaded in descending insertion order. */
  order: "asc" | "desc";
  /**
   * "tenant" (default): every row carries tenant_id; requests load and write only their tenant's rows,
   * and `unique` fields are unique per tenant. "user": global per-person records (accounts, devices);
   * a tenant loads the rows of its members only.
   */
  scope?: "tenant" | "user";
  fields: readonly FieldSpec[];
  children?: readonly ChildSpec[];
};

const id = ["id", "text", { required: true }] as const;

export const TABLES: readonly TableSpec[] = [
  {
    table: "outlets",
    source: { kind: "data", key: "outlets" },
    order: "asc",
    fields: [id, ["name", "text", { required: true }], ["code", "text", { required: true, unique: true }], ["type", "text"], ["address", "text"], ["manager", "text"], ["phone", "text"], ["pcnLicense", "text"], ["licenceExpiry", "text"], ["status", "text"], ["stockValue", "money"], ["sales", "money"]],
  },
  {
    table: "users",
    source: { kind: "data", key: "users" },
    order: "asc",
    scope: "user",
    // Staff IDs are unique per pharmacy (on tenant_memberships), so only an index here.
    fields: [id, ["staffId", "text", { index: true }], ["name", "text", { required: true }], ["email", "text", { required: true, unique: true }], ["phone", "text"], ["password", "text"], ["passwordHash", "text"], ["role", "text", { required: true, index: true }], ["outletId", "text", { index: true }], ["status", "text"], ["grants", "json"], ["lastLogin", "text"], ["createdAt", "text"], ["invite", "json"], ["emailVerifiedAt", "text"], ["passwordChangedAt", "text"]],
    children: [{ table: "user_outlets", property: "outletIds", parentColumn: "user_id", scalarColumn: "outlet_id" }],
  },
  {
    table: "products",
    source: { kind: "data", key: "products" },
    order: "asc",
    fields: [id, ["name", "text", { required: true, index: true }], ["genericName", "text"], ["category", "text"], ["manufacturer", "text"], ["strength", "text"], ["size", "text"], ["uom", "text"], ["purchasePrice", "money"], ["sellingPrice", "money"], ["minStock", "int"], ["maxStock", "int"], ["stock", "int"], ["status", "text"], ["barcode", "text"], ["nafdacNumber", "text"], ["outletId", "text", { required: true, index: true, ref: "outlets" }], ["expiryWindow", "text"], ["rxOnly", "bool"], ["controlled", "bool"], ["thresholdSource", "text"], ["sku", "text", { index: true }], ["productType", "text"], ["dosageForm", "text"], ["description", "text"], ["supplierId", "text", { ref: "suppliers" }], ["lifecycle", "text"], ["baseUnit", "text"], ["wholesalePrice", "money"], ["minSellingPrice", "money"]],
    children: [
      {
        table: "product_packaging",
        property: "packaging",
        parentColumn: "product_id",
        fields: [["id", "text"], ["name", "text"], ["contains", "int"], ["unitsPerPackage", "int"], ["isBase", "bool"], ["purchasePrice", "money"], ["sellingPrice", "money"], ["wholesalePrice", "money"], ["minSellingPrice", "money"], ["sellable", "bool"]],
      },
      {
        table: "product_barcodes",
        property: "barcodes",
        parentColumn: "product_id",
        fields: [["code", "text", { index: true }], ["format", "text"], ["source", "text"], ["packagingId", "text"]],
      },
    ],
  },
  {
    table: "batches",
    source: { kind: "data", key: "batches" },
    order: "desc",
    fields: [id, ["batchNumber", "text", { required: true, index: true }], ["productId", "text", { required: true, index: true, ref: "products" }], ["productName", "text"], ["supplier", "text"], ["assignedOutletId", "text", { required: true, index: true, ref: "outlets" }], ["receivingDate", "text"], ["manufacturingDate", "text"], ["expiryDate", "text", { required: true, index: true }], ["quantityReceived", "int"], ["availableQuantity", "int"], ["purchasePrice", "money"], ["disposition", "json"], ["supplierId", "text", { ref: "suppliers" }], ["supplierBatchRef", "text"], ["regulatoryNumber", "text"]],
  },
  {
    table: "stock_movements",
    source: { kind: "data", key: "stockMovements" },
    order: "desc",
    fields: [id, ["reference", "text"], ["date", "text", { index: true }], ["type", "text"], ["outletId", "text", { index: true, ref: "outlets" }], ["toOutletId", "text", { ref: "outlets" }], ["productId", "text", { index: true, ref: "products" }], ["productName", "text"], ["quantity", "int"], ["status", "text", { index: true }], ["batchId", "text", { ref: "batches" }], ["disposition", "text"], ["reason", "text"], ["requestedBy", "text"], ["approvedBy", "text"], ["direction", "text"], ["invoiceNumber", "text"], ["purchaseReference", "text"]],
  },
  {
    table: "stock_ledger",
    source: { kind: "store", key: "stockLedger" },
    order: "desc",
    fields: [id, ["reference", "text", { required: true, index: true }], ["at", "text", { required: true, index: true }], ["type", "text", { required: true, index: true }], ["productId", "text", { required: true, index: true, ref: "products" }], ["productName", "text"], ["outletId", "text", { required: true, index: true, ref: "outlets" }], ["batchId", "text", { required: true, index: true, ref: "batches" }], ["batchNumber", "text"], ["quantity", "real"], ["unit", "text"], ["unitsPerUnit", "int"], ["baseQuantity", "int", { required: true }], ["previousBalance", "int"], ["newBalance", "int"], ["batchBalance", "int"], ["unitCost", "money"], ["userId", "text"], ["userName", "text"], ["remarks", "text"], ["movementId", "text"]],
  },
  {
    table: "price_history",
    source: { kind: "store", key: "priceHistory" },
    order: "desc",
    fields: [id, ["at", "text", { required: true }], ["productId", "text", { required: true, index: true, ref: "products" }], ["productName", "text"], ["outletId", "text", { ref: "outlets" }], ["level", "text"], ["kind", "text"], ["oldValue", "money"], ["newValue", "money"], ["userId", "text"], ["userName", "text"]],
  },
  {
    table: "held_sales",
    source: { kind: "store", key: "heldSales" },
    order: "desc",
    fields: [id, ["reference", "text", { required: true }], ["kind", "text", { required: true }], ["outletId", "text", { required: true, index: true, ref: "outlets" }], ["cashierId", "text", { index: true }], ["cashierName", "text"], ["createdAt", "text"], ["updatedAt", "text"], ["label", "text"], ["cart", "json"]],
  },
  {
    table: "stock_transfers",
    source: { kind: "store", key: "transfers" },
    order: "desc",
    fields: [id, ["reference", "text", { required: true, unique: true }], ["fromOutletId", "text", { required: true, index: true, ref: "outlets" }], ["toOutletId", "text", { required: true, index: true, ref: "outlets" }], ["status", "text", { required: true, index: true }], ["lines", "json"], ["notes", "text"], ["createdAt", "text"], ["createdBy", "text"], ["createdById", "text"], ["approvedBy", "text"], ["dispatchedAt", "text"], ["dispatchedBy", "text"], ["receivedAt", "text"], ["receivedBy", "text"], ["discrepancies", "json"], ["history", "json"]],
  },
  {
    table: "customers",
    source: { kind: "store", key: "customers" },
    order: "asc",
    fields: [id, ["code", "text", { unique: true }], ["name", "text", { required: true }], ["type", "text"], ["phone", "text"], ["email", "text"], ["outletId", "text", { ref: "outlets" }], ["creditLimit", "money"], ["balance", "money"], ["status", "text"], ["createdAt", "text"]],
  },
  {
    table: "suppliers",
    source: { kind: "store", key: "suppliers" },
    order: "asc",
    fields: [id, ["code", "text", { unique: true }], ["name", "text", { required: true }], ["contactPerson", "text"], ["phone", "text"], ["email", "text"], ["pcnLicense", "text"], ["paymentTermsDays", "int"], ["balance", "money"], ["status", "text"], ["categories", "text"]],
  },
  {
    table: "sales",
    source: { kind: "store", key: "sales" },
    order: "desc",
    fields: [id, ["number", "text", { unique: true }], ["date", "text", { required: true, index: true }], ["outletId", "text", { required: true, index: true, ref: "outlets" }], ["customerId", "text", { index: true, ref: "customers" }], ["customerName", "text"], ["cashier", "text"], ["cashierId", "text", { index: true }], ["subtotal", "money"], ["discount", "money"], ["vat", "money"], ["total", "money"], ["amountPaid", "money"], ["paymentMethod", "text"], ["status", "text", { index: true }], ["prescriptionRef", "text"], ["voidReason", "text"], ["payments", "json"], ["tendered", "money"], ["change", "money"], ["globalDiscount", "json"], ["discountAuthorisedBy", "text"], ["walkIn", "json"], ["customerKind", "text"], ["heldId", "text"], ["receiptPrints", "int"], ["offline", "json"], ["migrated", "json"]],
    children: [
      {
        table: "sale_lines",
        property: "lines",
        parentColumn: "sale_id",
        fields: [["productId", "text", { index: true }], ["productName", "text"], ["batchNumbers", "json"], ["quantity", "int"], ["unitPrice", "money"], ["discount", "money"], ["total", "money"], ["packagingName", "text"], ["unitsPerPackage", "int"], ["packQuantity", "real"], ["packPrice", "money"], ["allocations", "json"]],
      },
    ],
  },
  {
    table: "purchase_orders",
    source: { kind: "store", key: "purchaseOrders" },
    order: "desc",
    fields: [id, ["number", "text", { unique: true }], ["supplierId", "text", { index: true, ref: "suppliers" }], ["supplierName", "text"], ["outletId", "text", { index: true, ref: "outlets" }], ["createdAt", "text"], ["expectedDate", "text"], ["createdBy", "text"], ["createdById", "text"], ["approvedBy", "text"], ["status", "text", { index: true }], ["total", "money"], ["amountPaid", "money"], ["notes", "text"]],
    children: [
      {
        table: "purchase_order_lines",
        property: "lines",
        parentColumn: "purchase_order_id",
        fields: [["productId", "text"], ["productName", "text"], ["quantity", "int"], ["unitCost", "money"], ["receivedQuantity", "int"]],
      },
    ],
  },
  {
    table: "payments",
    source: { kind: "store", key: "payments" },
    order: "desc",
    fields: [id, ["reference", "text"], ["date", "text", { index: true }], ["direction", "text"], ["partyType", "text"], ["partyId", "text", { index: true }], ["partyName", "text"], ["documentRef", "text"], ["method", "text"], ["account", "text"], ["amount", "money"], ["recordedBy", "text"]],
  },
  {
    table: "expenses",
    source: { kind: "store", key: "expenses" },
    order: "desc",
    fields: [id, ["reference", "text", { unique: true }], ["date", "text"], ["category", "text"], ["description", "text"], ["vendor", "text"], ["outletId", "text", { index: true, ref: "outlets" }], ["amount", "money"], ["status", "text"], ["requestedBy", "text"], ["requestedById", "text"], ["approvedBy", "text"]],
  },
  {
    table: "audit_events",
    source: { kind: "store", key: "audit" },
    order: "desc",
    fields: [id, ["at", "text", { required: true, index: true }], ["actorId", "text", { index: true }], ["actorName", "text"], ["actorRole", "text"], ["action", "text", { index: true }], ["entity", "text"], ["entityId", "text"], ["summary", "text"], ["outletId", "text"], ["severity", "text"], ["impersonationId", "text", { index: true }], ["impersonatorId", "text"], ["impersonatorName", "text"]],
  },
  {
    table: "product_registrations",
    source: { kind: "store", key: "registrations" },
    order: "asc",
    fields: [id, ["productName", "text", { required: true, unique: true }], ["genericName", "text"], ["manufacturer", "text"], ["category", "text"], ["nafdacNumber", "text"], ["issuedDate", "text"], ["expiryDate", "text"], ["notes", "text"], ["updatedBy", "text"], ["updatedAt", "text"], ["status", "text"], ["renewalDate", "text"], ["localRepresentative", "text"]],
  },
  {
    table: "regulatory_documents",
    source: { kind: "store", key: "documents" },
    order: "desc",
    fields: [id, ["title", "text"], ["category", "text"], ["relatedTo", "text"], ["fileName", "text"], ["mimeType", "text"], ["size", "int"], ["storedName", "text"], ["expiresOn", "text"], ["uploadedBy", "text"], ["uploadedAt", "text"]],
  },
  {
    table: "inventory_alerts",
    source: { kind: "store", key: "alerts" },
    order: "desc",
    fields: [id, ["key", "text", { required: true, index: true }], ["type", "text"], ["severity", "text"], ["status", "text", { index: true }], ["outletId", "text", { index: true, ref: "outlets" }], ["productId", "text", { ref: "products" }], ["productName", "text"], ["batchId", "text", { ref: "batches" }], ["batchNumber", "text"], ["snapshot", "json"], ["createdAt", "text"], ["updatedAt", "text"], ["resolvedManually", "bool"], ["clearedAt", "text"], ["notified", "json"], ["history", "json"]],
  },
  {
    table: "notifications",
    source: { kind: "store", key: "notifications" },
    order: "desc",
    fields: [id, ["userId", "text", { required: true, index: true }], ["alertId", "text"], ["title", "text"], ["body", "text"], ["severity", "text"], ["link", "text"], ["createdAt", "text"], ["readAt", "text"]],
  },
  {
    table: "notification_deliveries",
    source: { kind: "store", key: "deliveries" },
    order: "desc",
    fields: [id, ["at", "text"], ["channel", "text"], ["recipientId", "text", { index: true }], ["recipientName", "text"], ["recipientEmail", "text"], ["subject", "text"], ["event", "text", { index: true }], ["alertId", "text"], ["status", "text", { index: true }], ["detail", "text"], ["attempts", "int"], ["nextAttemptAt", "text"], ["payload", "json"]],
  },
  {
    table: "sale_returns",
    source: { kind: "store", key: "saleReturns" },
    order: "desc",
    fields: [id, ["number", "text", { unique: true }], ["saleId", "text", { required: true, index: true, ref: "sales" }], ["saleNumber", "text"], ["outletId", "text", { required: true, index: true, ref: "outlets" }], ["date", "text", { required: true, index: true }], ["processedBy", "text"], ["processedById", "text"], ["cashier", "text"], ["cashierId", "text"], ["net", "money"], ["vat", "money"], ["total", "money"], ["refundMethod", "text"], ["refundedAmount", "money"], ["creditedAmount", "money"], ["reason", "text"], ["restocked", "bool"]],
    children: [
      {
        table: "sale_return_lines",
        property: "lines",
        parentColumn: "sale_return_id",
        fields: [["productId", "text"], ["productName", "text"], ["quantity", "int"], ["unitNet", "money"], ["net", "money"], ["vat", "money"], ["total", "money"]],
      },
    ],
  },
  {
    table: "impersonation_sessions",
    source: { kind: "store", key: "impersonations" },
    order: "desc",
    fields: [id, ["adminId", "text", { required: true, index: true }], ["adminName", "text"], ["targetId", "text", { required: true, index: true }], ["targetName", "text"], ["targetRole", "text"], ["targetStaffId", "text"], ["reason", "text"], ["startedAt", "text", { required: true }], ["expiresAt", "text"], ["endedAt", "text"], ["endReason", "text"], ["actions", "int"]],
  },
  {
    table: "devices",
    source: { kind: "store", key: "devices" },
    order: "asc",
    scope: "user",
    fields: [id, ["userId", "text", { index: true }], ["token", "text", { unique: true }], ["platform", "text"], ["label", "text"], ["registeredAt", "text"], ["lastSeenAt", "text"]],
  },
];

/** Single-value records (settings, counters, job markers, role permission matrix) live in this key/value table. */
export const KV_TABLE = "app_state";

export function columnName(field: string) {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
