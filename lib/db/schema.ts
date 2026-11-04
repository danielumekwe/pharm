// Database schema: single source of truth for the PostgreSQL tables and generated Prisma schema.
// Pure data (no imports) so scripts can load it directly with Node.

export type FieldKind = "text" | "int" | "real" | "bool" | "json";
export type FieldSpec = readonly [field: string, kind: FieldKind, options?: { required?: boolean; unique?: boolean; index?: boolean }];

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
  fields: readonly FieldSpec[];
  children?: readonly ChildSpec[];
};

const id = ["id", "text", { required: true }] as const;

export const TABLES: readonly TableSpec[] = [
  {
    table: "outlets",
    source: { kind: "data", key: "outlets" },
    order: "asc",
    fields: [id, ["name", "text", { required: true }], ["code", "text", { required: true, unique: true }], ["type", "text"], ["address", "text"], ["manager", "text"], ["phone", "text"], ["pcnLicense", "text"], ["licenceExpiry", "text"], ["status", "text"], ["stockValue", "real"], ["sales", "real"]],
  },
  {
    table: "users",
    source: { kind: "data", key: "users" },
    order: "asc",
    fields: [id, ["staffId", "text", { unique: true }], ["name", "text", { required: true }], ["email", "text", { required: true, unique: true }], ["phone", "text"], ["password", "text"], ["passwordHash", "text"], ["role", "text", { required: true, index: true }], ["outletId", "text", { index: true }], ["status", "text"], ["grants", "json"], ["lastLogin", "text"], ["createdAt", "text"], ["invite", "json"]],
    children: [{ table: "user_outlets", property: "outletIds", parentColumn: "user_id", scalarColumn: "outlet_id" }],
  },
  {
    table: "products",
    source: { kind: "data", key: "products" },
    order: "asc",
    fields: [id, ["name", "text", { required: true, index: true }], ["genericName", "text"], ["category", "text"], ["manufacturer", "text"], ["strength", "text"], ["uom", "text"], ["purchasePrice", "real"], ["sellingPrice", "real"], ["minStock", "int"], ["maxStock", "int"], ["stock", "int"], ["status", "text"], ["barcode", "text"], ["nafdacNumber", "text"], ["outletId", "text", { required: true, index: true }], ["expiryWindow", "text"], ["rxOnly", "bool"], ["controlled", "bool"], ["thresholdSource", "text"]],
  },
  {
    table: "batches",
    source: { kind: "data", key: "batches" },
    order: "desc",
    fields: [id, ["batchNumber", "text", { required: true, index: true }], ["productId", "text", { required: true, index: true }], ["productName", "text"], ["supplier", "text"], ["assignedOutletId", "text", { required: true, index: true }], ["receivingDate", "text"], ["manufacturingDate", "text"], ["expiryDate", "text", { required: true, index: true }], ["quantityReceived", "int"], ["availableQuantity", "int"], ["purchasePrice", "real"], ["disposition", "json"]],
  },
  {
    table: "stock_movements",
    source: { kind: "data", key: "stockMovements" },
    order: "desc",
    fields: [id, ["reference", "text"], ["date", "text", { index: true }], ["type", "text"], ["outletId", "text", { index: true }], ["toOutletId", "text"], ["productName", "text"], ["quantity", "int"], ["status", "text", { index: true }], ["batchId", "text"], ["disposition", "text"], ["reason", "text"], ["requestedBy", "text"], ["approvedBy", "text"]],
  },
  {
    table: "customers",
    source: { kind: "store", key: "customers" },
    order: "asc",
    fields: [id, ["code", "text", { unique: true }], ["name", "text", { required: true }], ["type", "text"], ["phone", "text"], ["email", "text"], ["outletId", "text"], ["creditLimit", "real"], ["balance", "real"], ["status", "text"], ["createdAt", "text"]],
  },
  {
    table: "suppliers",
    source: { kind: "store", key: "suppliers" },
    order: "asc",
    fields: [id, ["code", "text", { unique: true }], ["name", "text", { required: true }], ["contactPerson", "text"], ["phone", "text"], ["email", "text"], ["pcnLicense", "text"], ["paymentTermsDays", "int"], ["balance", "real"], ["status", "text"], ["categories", "text"]],
  },
  {
    table: "sales",
    source: { kind: "store", key: "sales" },
    order: "desc",
    fields: [id, ["number", "text", { unique: true }], ["date", "text", { required: true, index: true }], ["outletId", "text", { required: true, index: true }], ["customerId", "text", { index: true }], ["customerName", "text"], ["cashier", "text"], ["cashierId", "text", { index: true }], ["subtotal", "real"], ["discount", "real"], ["vat", "real"], ["total", "real"], ["amountPaid", "real"], ["paymentMethod", "text"], ["status", "text", { index: true }], ["prescriptionRef", "text"], ["voidReason", "text"]],
    children: [
      {
        table: "sale_lines",
        property: "lines",
        parentColumn: "sale_id",
        fields: [["productId", "text", { index: true }], ["productName", "text"], ["batchNumbers", "json"], ["quantity", "int"], ["unitPrice", "real"], ["discount", "real"], ["total", "real"]],
      },
    ],
  },
  {
    table: "purchase_orders",
    source: { kind: "store", key: "purchaseOrders" },
    order: "desc",
    fields: [id, ["number", "text", { unique: true }], ["supplierId", "text", { index: true }], ["supplierName", "text"], ["outletId", "text", { index: true }], ["createdAt", "text"], ["expectedDate", "text"], ["createdBy", "text"], ["createdById", "text"], ["approvedBy", "text"], ["status", "text", { index: true }], ["total", "real"], ["amountPaid", "real"], ["notes", "text"]],
    children: [
      {
        table: "purchase_order_lines",
        property: "lines",
        parentColumn: "purchase_order_id",
        fields: [["productId", "text"], ["productName", "text"], ["quantity", "int"], ["unitCost", "real"], ["receivedQuantity", "int"]],
      },
    ],
  },
  {
    table: "payments",
    source: { kind: "store", key: "payments" },
    order: "desc",
    fields: [id, ["reference", "text"], ["date", "text", { index: true }], ["direction", "text"], ["partyType", "text"], ["partyId", "text", { index: true }], ["partyName", "text"], ["documentRef", "text"], ["method", "text"], ["account", "text"], ["amount", "real"], ["recordedBy", "text"]],
  },
  {
    table: "expenses",
    source: { kind: "store", key: "expenses" },
    order: "desc",
    fields: [id, ["reference", "text", { unique: true }], ["date", "text"], ["category", "text"], ["description", "text"], ["vendor", "text"], ["outletId", "text", { index: true }], ["amount", "real"], ["status", "text"], ["requestedBy", "text"], ["requestedById", "text"], ["approvedBy", "text"]],
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
    fields: [id, ["productName", "text", { required: true, unique: true }], ["genericName", "text"], ["manufacturer", "text"], ["category", "text"], ["nafdacNumber", "text"], ["issuedDate", "text"], ["expiryDate", "text"], ["notes", "text"], ["updatedBy", "text"], ["updatedAt", "text"]],
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
    fields: [id, ["key", "text", { required: true, index: true }], ["type", "text"], ["severity", "text"], ["status", "text", { index: true }], ["outletId", "text", { index: true }], ["productId", "text"], ["productName", "text"], ["batchId", "text"], ["batchNumber", "text"], ["snapshot", "json"], ["createdAt", "text"], ["updatedAt", "text"], ["resolvedManually", "bool"], ["clearedAt", "text"], ["notified", "json"], ["history", "json"]],
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
    fields: [id, ["number", "text", { unique: true }], ["saleId", "text", { required: true, index: true }], ["saleNumber", "text"], ["outletId", "text", { required: true, index: true }], ["date", "text", { required: true, index: true }], ["processedBy", "text"], ["processedById", "text"], ["cashier", "text"], ["cashierId", "text"], ["net", "real"], ["vat", "real"], ["total", "real"], ["refundMethod", "text"], ["refundedAmount", "real"], ["creditedAmount", "real"], ["reason", "text"], ["restocked", "bool"]],
    children: [
      {
        table: "sale_return_lines",
        property: "lines",
        parentColumn: "sale_return_id",
        fields: [["productId", "text"], ["productName", "text"], ["quantity", "int"], ["unitNet", "real"], ["net", "real"], ["vat", "real"], ["total", "real"]],
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
    fields: [id, ["userId", "text", { index: true }], ["token", "text", { unique: true }], ["platform", "text"], ["label", "text"], ["registeredAt", "text"], ["lastSeenAt", "text"]],
  },
];

/** Single-value records (settings, counters, job markers, role permission matrix) live in this key/value table. */
export const KV_TABLE = "app_state";

export function columnName(field: string) {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
