// Shared TypeScript types for the mobile app — mirrors the backend shapes.

export type Role =
  | 'SUPER_ADMIN'
  | 'PHARMACY_MANAGER'
  | 'REGULATORY_OFFICER'
  | 'SALES_MANAGER'
  | 'STOCK_MANAGER'
  | 'CASHIER'
  | 'STAFF';

export type Permission = string;

export interface OutletRef {
  id: string;
  name: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  outletId: string | null;
  outletIds: string[];
  outlets: OutletRef[];
  permissions: Permission[];
}

// ---------------------------------------------------------------- Dashboard types

export type DashboardKind = 'admin' | 'manager' | 'sales' | 'cashier' | 'inventory' | 'regulatory';

export interface Dashboard {
  kind: DashboardKind;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------- POS types

export interface PosBatch {
  batchNumber: string;
  expiryDate: string;
  days: number;
  quantity: number;
}

export interface PosPackaging {
  id: string;
  name: string;
  unitsPerPackage: number;
  price: number;
  minPrice: number | null;
  barcodes: string[];
}

export interface PosCatalogItem {
  id: string;
  name: string;
  sku: string;
  genericName: string | null;
  strength: string | null;
  category: string;
  dosageForm: string;
  baseUnit: string;
  rxOnly: boolean;
  controlled: boolean;
  available: number;
  minStock: number;
  barcodes: string[];
  batches: PosBatch[];
  packaging: PosPackaging[];
}

export type PaymentMethod = 'Cash' | 'Card' | 'Transfer';

export interface BasketLine {
  productId: string;
  productName: string;
  packagingId: string | null;
  packagingName: string;
  unitsPerPackage: number;
  quantity: number;
  unitPrice: number;
  discount: { type: 'percent' | 'amount'; value: number } | null;
  lineTotal: number;
}

export interface Basket {
  outletId: string;
  lines: BasketLine[];
  globalDiscount: { type: 'percent' | 'amount'; value: number } | null;
  customer: { id: string; name: string } | { walkIn: { name: string; phone: string } } | null;
  prescriptionRef: string;
}

export interface PaymentTender {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface HeldSale {
  id: string;
  reference: string;
  kind: 'HELD' | 'DRAFT';
  label?: string;
  lines: number;
  updatedAt: string;
}

export interface SaleResult {
  id: string;
  number: string;
  date: string;
  total: number;
  discount: number;
  change: number;
  status: string;
  paymentMethod: string;
  payments: { method: string; amount: number }[];
  lines: { productName: string; quantity: number; total: number; allocations: { batchNumber: string }[] }[];
  customerName: string;
  prescriptionRef?: string;
}

// ---------------------------------------------------------------- Sales history

export interface SaleHistoryRow {
  id: string;
  number: string;
  date: string;
  customer: string;
  cashier: string;
  outlet: string;
  items: number;
  gross: number;
  discount: number;
  net: number;
  total: number;
  methods: string[];
  paymentLabel: string;
  status: string;
}

export interface SalesHistory {
  rows: SaleHistoryRow[];
  totals: {
    transactions: number;
    gross: number;
    discount: number;
    returns: number;
    net: number;
    voided: number;
  };
}

// ---------------------------------------------------------------- Stock levels

export interface StockLevelRow {
  id: string;
  name: string;
  strength: string | null;
  category: string;
  outlet: string;
  outletId: string;
  unit: string;
  available: number;
  packs: string;
  status: string;
  rxOnly: boolean;
  nextExpiry: string | null;
}

// ---------------------------------------------------------------- Transfers

export interface TransferLine {
  productId: string;
  productName: string;
  requested: number;
  dispatched: { batchNumber: string; quantity: number }[];
  received: { batchNumber: string; quantity: number }[];
}

export interface Transfer {
  id: string;
  reference: string;
  fromOutletId: string;
  toOutletId: string;
  status: string;
  lines: TransferLine[];
  notes?: string;
  createdAt: string;
  history: { at: string; actor: string; action: string; note?: string }[];
}

// ---------------------------------------------------------------- Alerts

export interface Alert {
  id: string;
  kind: string;
  severity: string;
  message: string;
  productId?: string;
  productName?: string;
  outletId?: string;
  createdAt: string;
  read: boolean;
}

// ---------------------------------------------------------------- Notifications

export interface Notification {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  createdAt: string;
}
