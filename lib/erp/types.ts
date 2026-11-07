// ERP domain types. Shapes mirror the Prisma models in prisma/schema.prisma so the
// in-memory store can be swapped for database repositories without touching the UI.

import type { Permission, Role } from "@/lib/rbac";

export type Actor = {
  id: string;
  name: string;
  role: Role;
  /** Active outlet. Null means "all outlets" (central roles only). */
  outletId: string | null;
  /** Every outlet this user may work in. */
  outletIds: string[];
  /** Effective permissions: live role permissions plus individual grants. */
  permissions: Permission[];
  /** Present when a Super Administrator is acting as this user. */
  impersonation?: { sessionId: string; adminId: string; adminName: string; expiresAt: string };
  /** The pharmacy (tenant) of the request; set by getActor from the verified session. */
  tenantId?: string;
  /** Present for a Web365 support session (read-only, approved by the pharmacy). */
  support?: { grantId: string };
};

export type CustomerType = "Walk-in" | "Retail" | "Corporate" | "HMO" | "Clinic";

export type Customer = {
  id: string;
  code: string;
  name: string;
  type: CustomerType;
  phone: string;
  email: string;
  outletId: string | null;
  creditLimit: number;
  /** Amount the customer owes us (accounts receivable). */
  balance: number;
  status: "Active" | "On hold";
  createdAt: string;
};

export type Supplier = {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  pcnLicense: string;
  paymentTermsDays: number;
  /** Amount we owe the supplier (accounts payable). */
  balance: number;
  status: "Approved" | "Pending verification" | "Suspended";
  categories: string;
};

/** "Card" is a POS-terminal payment; "Split" means several tender types (see SaleInvoice.payments). */
export type PaymentMethod = "Cash" | "Card" | "Transfer" | "Credit" | "HMO" | "Split";
export type TenderMethod = "Cash" | "Card" | "Transfer";
export type SaleTender = { method: TenderMethod; amount: number; reference?: string };

export type SaleLine = {
  productId: string;
  productName: string;
  batchNumbers: string[];
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  /** Package sold (e.g. "Strip"); quantity above is always in base units. */
  packagingName?: string;
  unitsPerPackage?: number;
  /** Number of packages sold and the price charged per package. */
  packQuantity?: number;
  packPrice?: number;
  /** Exact batches the base units were drawn from (FEFO), used to reverse voids and returns. */
  allocations?: { batchId: string; batchNumber: string; quantity: number }[];
};

export type SaleStatus = "Paid" | "Partially paid" | "Unpaid" | "Voided";

export type SaleInvoice = {
  id: string;
  number: string;
  date: string;
  outletId: string;
  customerId: string | null;
  customerName: string;
  cashier: string;
  /** User id of the cashier (older records only carry the name). */
  cashierId?: string;
  lines: SaleLine[];
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  amountPaid: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  prescriptionRef?: string;
  voidReason?: string;
  /** Tender split. Absent on older sales (paymentMethod then covers amountPaid). */
  payments?: SaleTender[];
  /** Cash handed over and change given back (cash tenders only). */
  tendered?: number;
  change?: number;
  /** Transaction-level discount as entered (the amount is included in `discount`). */
  globalDiscount?: { type: "percent" | "amount"; value: number; amount: number };
  /** Who authorised discounts above the cashier limit (the cashier when within their own limit). */
  discountAuthorisedBy?: string;
  /** Walk-in customer details captured at the till (no customer account). */
  walkIn?: { name?: string; phone?: string };
  customerKind?: "Normal" | "Family";
  /** Held/draft basket this sale was completed from. */
  heldId?: string;
  receiptPrints?: number;
};

/** A basket parked at the till (held for a waiting customer, or saved as a draft). Not a sale: no stock moves. */
export type HeldSale = {
  id: string;
  reference: string;
  kind: "HELD" | "DRAFT";
  outletId: string;
  cashierId: string;
  cashierName: string;
  createdAt: string;
  updatedAt: string;
  label?: string;
  /** The POS cart as entered: lines, customer and discount settings. */
  cart: {
    lines: { productId: string; packagingId?: string; quantity: number; discount?: { type: "percent" | "amount"; value: number } }[];
    customerId?: string | null;
    walkIn?: { name?: string; phone?: string };
    customerKind?: "Normal" | "Family";
    globalDiscount?: { type: "percent" | "amount"; value: number };
    prescriptionRef?: string;
  };
};

export const TRANSFER_STATUSES = ["Draft", "Pending approval", "Approved", "Dispatched", "Partially received", "Received", "Rejected", "Cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export type StockTransferLine = {
  productId: string;
  productName: string;
  /** Base units. */
  requested: number;
  /** Batches that left the source outlet (FEFO at dispatch). */
  dispatched: { batchId: string; batchNumber: string; expiryDate: string; quantity: number }[];
  /** Units confirmed at the destination, per batch number. */
  received: { batchNumber: string; quantity: number }[];
};

/** Explicit inter-outlet transfer: request → approval → dispatch → receipt, with discrepancies recorded. */
export type StockTransfer = {
  id: string;
  reference: string;
  fromOutletId: string;
  toOutletId: string;
  status: TransferStatus;
  lines: StockTransferLine[];
  notes?: string;
  createdAt: string;
  createdBy: string;
  createdById: string;
  approvedBy?: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  receivedAt?: string;
  receivedBy?: string;
  /** Dispatched but not received, per batch, with the receiver's explanation. */
  discrepancies: { productName: string; batchNumber: string; missing: number; note: string }[];
  history: { at: string; actor: string; action: string; note?: string }[];
};

export type PurchaseOrderLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  receivedQuantity: number;
};

export type PurchaseOrderStatus =
  | "Draft"
  | "Pending approval"
  | "Approved"
  | "Partially received"
  | "Received"
  | "Cancelled";

export type PurchaseOrder = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  outletId: string;
  createdAt: string;
  expectedDate: string;
  createdBy: string;
  createdById: string;
  approvedBy?: string;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLine[];
  total: number;
  amountPaid: number;
  notes?: string;
};

export type Payment = {
  id: string;
  reference: string;
  date: string;
  direction: "IN" | "OUT";
  partyType: "Customer" | "Supplier" | "Expense";
  partyId: string;
  partyName: string;
  documentRef: string;
  method: Exclude<PaymentMethod, "Credit" | "Split">;
  account: string;
  amount: number;
  recordedBy: string;
};

export type ExpenseStatus = "Submitted" | "Approved" | "Rejected" | "Paid";

export type Expense = {
  id: string;
  reference: string;
  date: string;
  category: string;
  description: string;
  vendor: string;
  outletId: string;
  amount: number;
  status: ExpenseStatus;
  requestedBy: string;
  requestedById: string;
  approvedBy?: string;
};

export type AuditSeverity = "info" | "warning" | "critical";

export type AuditEvent = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  outletId: string | null;
  severity: AuditSeverity;
  /** Set when the action was taken during an impersonation session. */
  impersonationId?: string;
  impersonatorId?: string;
  impersonatorName?: string;
};

export const EXPENSE_CATEGORIES = [
  "Utilities",
  "Rent",
  "Generator & Diesel",
  "Staff welfare",
  "Logistics",
  "Maintenance",
  "Regulatory fees",
  "Cold-chain",
  "Marketing",
  "Bank charges",
] as const;

export const BANK_ACCOUNTS = ["Cash till", "GTBank ••2231", "Access ••7710", "POS settlement ••0912"] as const;

export type SystemSettings = {
  /** Shown as the site title and next to the logo. */
  businessName: string;
  /** Stored file name of the uploaded logo; null shows the built-in mark. */
  logoFile: string | null;
  /** VAT charged on sales, in percent. */
  vatRate: number;
  /** Minimum remaining shelf life accepted at goods receipt, in days. */
  minShelfLifeDays: number;
  /** Largest expiry warning interval (kept in step with expiryIntervals). */
  nearExpiryDays: number;
  /** Near-expiry warning intervals in days, e.g. 150, 120, 90, 60, 30. */
  expiryIntervals: number[];
  /** Stock at or below this % of the minimum is a critical shortage. */
  criticalShortagePct: number;
  /** Hour of day (0–23, server time) for the daily alert summary. */
  dailySummaryHour: number;
  impersonation: {
    enabled: boolean;
    /** What happens to running sessions when the feature is switched off. */
    onDisable: "terminate" | "expire";
    maxMinutes: number;
  };
  lowStock: {
    /** Minimum stock for items with no product, outlet or item-specific threshold. */
    defaultMin: number;
    outletMins: Record<string, number>;
    productMins: Record<string, number>;
  };
  alertEmail: {
    enabled: boolean;
    /** Extra addresses that receive inventory alert emails. */
    recipients: string[];
    /** Also email users who manage alerts for the outlet. */
    notifyManagers: boolean;
    lowStockImmediate: boolean;
    criticalImmediate: boolean;
    dailySummary: boolean;
    maxRetries: number;
  };
  /** How long staff invitation links stay valid, in hours. */
  inviteValidityHours: number;
  /** Supplier payments at or above this amount need approval rights. */
  supplierPaymentApprovalThreshold: number;
  passwordMinLength: number;
  /** Lists used by product registration, maintained by users with "catalog.manage". */
  catalog: ProductCatalogLists;
  pos: {
    /** Largest discount (% of the basket) a cashier may give without "sales.discount". */
    cashierMaxDiscountPct: number;
    /** Ceiling for users who hold "sales.discount". */
    approverMaxDiscountPct: number;
  };
  /** Daily sales target per outlet (₦). Outlets without a target show no progress bar. */
  salesTargets: Record<string, number>;
};

export type ProductCatalogLists = {
  categories: string[];
  dosageForms: string[];
  productTypes: string[];
  packagingTypes: string[];
};

export type RegistrationCategory = "Drug" | "Medical device" | "Supplement" | "Cosmetic";

export type ProductRegistration = {
  id: string;
  productName: string;
  genericName: string;
  manufacturer: string;
  category: RegistrationCategory;
  nafdacNumber: string;
  issuedDate: string;
  expiryDate: string;
  notes?: string;
  /** Registered, Pending, Renewal due, Expired, Suspended or Exempt. */
  status?: RegistrationStatus;
  renewalDate?: string;
  /** Local representative / marketing authorisation holder in Nigeria. */
  localRepresentative?: string;
  updatedBy: string;
  updatedAt: string;
};

export const REGISTRATION_STATUSES = ["Registered", "Pending", "Under review", "Renewal in progress", "Rejected", "Expired", "Suspended", "Exempt"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  "NAFDAC certificate",
  "PCN premises licence",
  "Superintendent pharmacist licence",
  "Inspection report",
  "Destruction certificate",
  "Standard operating procedure",
  "Other",
] as const;

export type RegulatoryDocument = {
  id: string;
  title: string;
  category: (typeof DOCUMENT_CATEGORIES)[number];
  /** Product name or outlet id the document relates to, if any. */
  relatedTo: string;
  fileName: string;
  mimeType: string;
  size: number;
  storedName: string;
  expiresOn?: string;
  uploadedBy: string;
  uploadedAt: string;
};

export type AlertType = "LOW_STOCK" | "EXPIRED" | "NEAR_EXPIRY";
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export type InventoryAlert = {
  id: string;
  /** Deduplication key: one live alert per condition (type + outlet + product/batch). */
  key: string;
  type: AlertType;
  severity: AuditSeverity;
  status: AlertStatus;
  outletId: string;
  productId: string;
  productName: string;
  batchId?: string;
  batchNumber?: string;
  /** Latest measured values from batch-level inventory. */
  snapshot: {
    available: number;
    minStock?: number;
    suggested?: number;
    onOrder?: number;
    expiryDate?: string;
    daysToExpiry?: number;
    window?: number;
    value?: number;
    disposition?: string;
  };
  createdAt: string;
  updatedAt: string;
  resolvedManually?: boolean;
  /** Set when a manually resolved condition has since cleared, so a recurrence opens a new alert. */
  clearedAt?: string;
  /** Notification events already sent for this alert (prevents duplicates). */
  notified: string[];
  history: { at: string; actor: string; action: string; note?: string }[];
};

export type AppNotification = {
  id: string;
  userId: string;
  alertId?: string;
  title: string;
  body: string;
  severity: AuditSeverity;
  link: string;
  createdAt: string;
  readAt?: string;
};

export type NotificationDelivery = {
  id: string;
  at: string;
  channel: "IN_APP" | "EMAIL" | "PUSH";
  recipientId: string;
  recipientName: string;
  subject: string;
  event: string;
  alertId?: string;
  status: "SENT" | "SKIPPED" | "FAILED" | "RETRYING";
  detail: string;
  recipientEmail?: string;
  attempts?: number;
  nextAttemptAt?: string;
  /** Email content kept for safe retries. */
  payload?: { to: string; subject: string; text: string };
};

export type SaleReturnLine = { productId: string; productName: string; quantity: number; unitNet: number; net: number; vat: number; total: number };

export type SaleReturn = {
  id: string;
  number: string;
  saleId: string;
  saleNumber: string;
  outletId: string;
  date: string;
  processedBy: string;
  processedById: string;
  cashier: string;
  cashierId?: string;
  lines: SaleReturnLine[];
  /** Value excluding VAT (reduces net sales). */
  net: number;
  vat: number;
  total: number;
  refundMethod: "Cash" | "Card" | "Transfer" | "Account credit";
  /** Paid back to the customer. */
  refundedAmount: number;
  /** Reduced from the customer's outstanding balance instead of paying out. */
  creditedAmount: number;
  reason: string;
  restocked: boolean;
};

export type ImpersonationSession = {
  id: string;
  adminId: string;
  adminName: string;
  targetId: string;
  targetName: string;
  targetRole: string;
  targetStaffId?: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt?: string;
  endReason?: string;
  actions: number;
};

export type DeviceRegistration = { id: string; userId: string; token: string; platform: "android" | "ios" | "web"; label?: string; registeredAt: string; lastSeenAt: string };

// ---------------------------------------------------------------- stock ledger

export const LEDGER_TYPES = [
  "OPENING",
  "RECEIVE",
  "SALE",
  "SALE_RETURN",
  "SALE_VOID",
  "ISSUE",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "WRITE_OFF",
  "SUPPLIER_RETURN",
] as const;
export type StockLedgerType = (typeof LEDGER_TYPES)[number];

/** One immutable stock transaction. Batch and item balances are always the running sum of these rows. */
export type StockLedgerEntry = {
  id: string;
  /** Document reference (GRN, invoice, transfer, adjustment…). */
  reference: string;
  at: string;
  type: StockLedgerType;
  productId: string;
  productName: string;
  outletId: string;
  batchId: string;
  batchNumber: string;
  /** Quantity in the unit it was entered in (e.g. 2 Cartons), always positive. */
  quantity: number;
  unit: string;
  unitsPerUnit: number;
  /** Signed change in base units (+ in, − out). */
  baseQuantity: number;
  /** Item balance at the outlet before and after, in base units. */
  previousBalance: number;
  newBalance: number;
  /** Batch balance after the transaction. */
  batchBalance: number;
  /** Cost per base unit at the time of the transaction. */
  unitCost: number;
  userId: string;
  userName: string;
  remarks?: string;
  /** Approval workflow record (stock_movements) that produced this entry, if any. */
  movementId?: string;
};

export type PriceChange = {
  id: string;
  at: string;
  productId: string;
  productName: string;
  outletId: string;
  /** Packaging level name, or the base unit. */
  level: string;
  kind: "purchase" | "selling" | "wholesale" | "minimum";
  oldValue: number | null;
  newValue: number | null;
  userId: string;
  userName: string;
};
