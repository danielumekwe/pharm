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

export type PaymentMethod = "Cash" | "Card" | "Transfer" | "Credit" | "HMO";

export type SaleLine = {
  productId: string;
  productName: string;
  batchNumbers: string[];
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
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
  method: Exclude<PaymentMethod, "Credit">;
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
  businessName: string;
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
  updatedBy: string;
  updatedAt: string;
};

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
