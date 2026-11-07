import { verifyPassword } from "@/lib/password";
import { DATA_VERSION } from "@/lib/data-version";
import { guardWorkingSet } from "@/lib/working-set";
import type { PackagingLevel, ProductBarcode } from "@/lib/erp/packaging";
import type { Role } from "@/lib/rbac";

export type { Role } from "@/lib/rbac";

/**
 * Keeps the working set on globalThis so every route bundle shares one copy. Callers get a guarded view:
 * it holds one tenant's data during that tenant's transaction only (see lib/working-set.ts).
 */
function persist<T extends object>(key: string, seed: T): T {
  const registry = globalThis as typeof globalThis & Record<string, unknown>;
  const slot = `__pharm_v${DATA_VERSION}_${key}`;
  if (!registry[slot]) registry[slot] = seed;
  return guardWorkingSet(registry[slot] as T);
}


export type UserStatus = "ACTIVE" | "SUSPENDED" | "DEACTIVATED" | "INVITED";

export type User = {
  id: string;
  name: string;
  email: string;
  password?: string;
  passwordHash?: string | null;
  role: Role;
  /** Primary (default) outlet. Null for central roles, which can see every outlet. */
  outletId: string | null;
  /** Every outlet the user may work in (includes the primary outlet). Empty for central roles. */
  outletIds?: string[];
  status?: UserStatus;
  /** Printed on the staff ID badge; accepted at sign-in instead of the email address. */
  staffId?: string;
  phone?: string;
  /** Extra permissions granted to this user on top of their role. */
  grants?: string[];
  lastLogin?: string;
  createdAt?: string;
  /** tenantId: the pharmacy that sent the invitation (absent on invitations issued before multi-tenancy). */
  invite?: { token: string; expiresAt: string; tenantId?: string } | null;
};

export type Outlet = {
  id: string;
  name: string;
  code: string;
  manager: string;
  address: string;
  stockValue: number;
  sales: number;
  /** RETAIL outlets sell to customers; WAREHOUSE locations only hold and dispatch stock. */
  type?: "RETAIL" | "WAREHOUSE";
  phone?: string;
  pcnLicense?: string;
  licenceExpiry?: string;
  status?: "ACTIVE" | "CLOSED";
};

export type Product = {
  id: string;
  name: string;
  genericName: string;
  category: string;
  manufacturer: string;
  strength: string;
  uom: string;
  purchasePrice: number;
  sellingPrice: number;
  minStock: number;
  stock: number;
  status: "ACTIVE" | "LOW_STOCK" | "RESTRICTED";
  barcode: string;
  nafdacNumber: string;
  outletId: string;
  expiryWindow: string;
  /** Prescription-only medicine: a prescription reference is required at point of sale. */
  rxOnly?: boolean;
  /** Controlled drug: every movement is flagged on the compliance register. */
  controlled?: boolean;
  /** Target stock level at this location; reorder suggestions top up to it. Defaults to 2 × minStock. */
  maxStock?: number;
  /**
   * Where minStock comes from: an explicit value for this item at this outlet ("item", the default for seeded items),
   * or inherited from a product-wide, outlet-wide or global default rule.
   */
  thresholdSource?: "item" | "product" | "outlet" | "default";
  /** Product code / SKU, unique per item name. */
  sku?: string;
  /** Product type, e.g. "Prescription medicine", "OTC medicine", "Consumable". */
  productType?: string;
  /** Dosage form, e.g. Tablet, Syrup, Injection (configurable list). */
  dosageForm?: string;
  /** Pack size or weight, e.g. 500g, 100ml. */
  size?: string;
  description?: string;
  /** Preferred supplier. */
  supplierId?: string;
  /** Catalogue lifecycle. Inactive items cannot be sold; discontinued items cannot be sold or received. */
  lifecycle?: "ACTIVE" | "INACTIVE" | "DISCONTINUED";
  /** Smallest unit stock is counted in (e.g. Tablet). Stock, batch quantities and the ledger use this unit. */
  baseUnit?: string;
  /** Per base unit. */
  wholesalePrice?: number;
  /** Per base unit; POS discounts may not take the price below it. */
  minSellingPrice?: number;
  /** Packaging levels, largest first; the last is the base unit. */
  packaging?: PackagingLevel[];
  barcodes?: ProductBarcode[];
};

export type BatchDisposition = {
  status: "QUARANTINED" | "RETURN_PENDING" | "RETURNED" | "DISPOSAL_PENDING" | "DISPOSED";
  by: string;
  at: string;
  note?: string;
  movementId?: string;
  supplier?: string;
};

export type BatchRecord = {
  id: string;
  batchNumber: string;
  productId: string;
  productName: string;
  supplier: string;
  assignedOutletId: string;
  receivingDate: string;
  manufacturingDate: string;
  expiryDate: string;
  quantityReceived: number;
  availableQuantity: number;
  purchasePrice: number;
  /** Expired-stock handling state (quarantine, return to supplier, disposal). */
  disposition?: BatchDisposition;
  supplierId?: string;
  /** The supplier's own batch reference, when it differs from the printed batch number. */
  supplierBatchRef?: string;
  /** Regulatory (e.g. NAFDAC) number printed on this batch. */
  regulatoryNumber?: string;
};

export type StockMovement = {
  id: string;
  reference: string;
  date: string;
  type: "Receive" | "Issue" | "Transfer" | "Adjustment" | "Return";
  outletId: string;
  productId?: string;
  productName: string;
  quantity: number;
  status: "Approved" | "Pending" | "Rejected";
  /** Destination location for transfers. */
  toOutletId?: string;
  /** Specific batch the movement targets (e.g. destruction of an expired batch). */
  batchId?: string;
  /** Expired-stock outcome this movement completes when approved. */
  disposition?: "RETURN" | "DISPOSAL";
  reason?: string;
  requestedBy?: string;
  approvedBy?: string;
  /** Adjustments only: IN adds counted stock to a batch, OUT (default) removes it. */
  direction?: "IN" | "OUT";
  /** Goods receipts: supplier invoice and purchase reference. */
  invoiceNumber?: string;
  purchaseReference?: string;
};

export const outlets: Outlet[] = persist("outlets", [
  {
    id: "outlet-1",
    phone: "0803 410 2201",
    pcnLicense: "PCN/PR/LA/2026/1182",
    licenceExpiry: "2026-12-31",
    status: "ACTIVE",
    name: "Outlet 1 - Lekki",
    code: "OUT-01",
    manager: "Aisha Bello",
    address: "Lekki Phase 1, Lagos",
    stockValue: 1265000,
    sales: 890000,
  },
  {
    id: "outlet-2",
    phone: "0803 410 2202",
    pcnLicense: "PCN/PR/LA/2026/1183",
    licenceExpiry: "2026-12-31",
    status: "ACTIVE",
    name: "Outlet 2 - Ikeja",
    code: "OUT-02",
    manager: "Tunde Adebayo",
    address: "Ikeja GRA, Lagos",
    stockValue: 1188000,
    sales: 770000,
  },
  {
    id: "outlet-3",
    phone: "0803 410 2203",
    pcnLicense: "PCN/PR/LA/2025/0954",
    licenceExpiry: "2026-11-30",
    status: "ACTIVE",
    name: "Outlet 3 - Victoria Island",
    code: "OUT-03",
    manager: "Maryam Yusuf",
    address: "Victoria Island, Lagos",
    stockValue: 1362000,
    sales: 940000,
  },
  {
    id: "wh-1",
    phone: "0803 410 2290",
    pcnLicense: "PCN/WS/LA/2026/0310",
    licenceExpiry: "2027-03-31",
    status: "ACTIVE",
    name: "Central Warehouse - Apapa",
    code: "WH-01",
    manager: "Ifeanyi Nwosu",
    address: "Creek Road, Apapa, Lagos",
    stockValue: 4820000,
    sales: 0,
    type: "WAREHOUSE",
  },
]);

export const users: User[] = persist("users", [
  {
    id: "user-1",
    staffId: "W365-0001",
    name: "Amina Adewale",
    email: "admin@web365.ng",
    phone: "0802 000 0001",
    password: "Admin@123",
    role: "SUPER_ADMIN",
    outletId: null,
    outletIds: [],
    status: "ACTIVE",
    createdAt: "2026-02-11T09:00:00.000Z",
  },
  {
    id: "user-2",
    staffId: "W365-0002",
    name: "Blessing Eze",
    email: "manager@web365.ng",
    phone: "0802 000 0002",
    password: "Admin@123",
    role: "PHARMACY_MANAGER",
    outletId: null,
    outletIds: [],
    status: "ACTIVE",
    createdAt: "2026-03-12T09:00:00.000Z",
  },
  {
    id: "user-3",
    staffId: "W365-0003",
    name: "Chinedu Okafor",
    email: "store@web365.ng",
    phone: "0803 221 4410",
    password: "Admin@123",
    role: "STOCK_MANAGER",
    outletId: "outlet-2",
    outletIds: ["outlet-2", "wh-1"],
    status: "ACTIVE",
    createdAt: "2026-04-13T09:00:00.000Z",
  },
  {
    id: "user-4",
    staffId: "W365-0004",
    name: "Grace Udo",
    email: "cashier@web365.ng",
    phone: "0805 118 2290",
    password: "Admin@123",
    role: "CASHIER",
    outletId: "outlet-1",
    outletIds: ["outlet-1"],
    status: "ACTIVE",
    createdAt: "2026-05-14T09:00:00.000Z",
  },
  {
    id: "user-5",
    staffId: "W365-0005",
    name: "Dr. Kemi Oladipo",
    email: "regulatory@web365.ng",
    phone: "0802 000 0005",
    password: "Admin@123",
    role: "REGULATORY_OFFICER",
    outletId: null,
    outletIds: [],
    status: "ACTIVE",
    createdAt: "2026-06-15T09:00:00.000Z",
  },
  {
    id: "user-6",
    staffId: "W365-0006",
    name: "Aisha Bello",
    email: "outlet@web365.ng",
    phone: "0803 410 2211",
    password: "Admin@123",
    role: "SALES_MANAGER",
    outletId: "outlet-1",
    outletIds: ["outlet-1"],
    status: "ACTIVE",
    createdAt: "2026-07-16T09:00:00.000Z",
  },
  {
    id: "user-7",
    staffId: "W365-0007",
    name: "Femi Ogunleye",
    email: "stock.lekki@web365.ng",
    phone: "0806 552 1033",
    password: "Admin@123",
    role: "STOCK_MANAGER",
    outletId: "outlet-1",
    outletIds: ["outlet-1"],
    status: "ACTIVE",
    createdAt: "2026-08-17T09:00:00.000Z",
  },
  {
    id: "user-8",
    staffId: "W365-0008",
    name: "Tunde Adebayo",
    email: "sales.ikeja@web365.ng",
    phone: "0803 410 2212",
    password: "Admin@123",
    role: "SALES_MANAGER",
    outletId: "outlet-2",
    outletIds: ["outlet-2"],
    status: "ACTIVE",
    createdAt: "2026-01-18T09:00:00.000Z",
  },
  {
    id: "user-9",
    staffId: "W365-0009",
    name: "Ngozi Eze",
    email: "staff.ikeja@web365.ng",
    phone: "0809 771 4402",
    password: "Admin@123",
    role: "STAFF",
    outletId: "outlet-2",
    outletIds: ["outlet-2"],
    status: "ACTIVE",
    createdAt: "2026-02-10T09:00:00.000Z",
  },
  {
    id: "user-10",
    staffId: "W365-0010",
    name: "Maryam Yusuf",
    email: "sales.vi@web365.ng",
    phone: "0803 410 2213",
    password: "Admin@123",
    role: "SALES_MANAGER",
    outletId: "outlet-3",
    outletIds: ["outlet-3"],
    status: "ACTIVE",
    createdAt: "2026-03-11T09:00:00.000Z",
  },
  {
    id: "user-11",
    staffId: "W365-0011",
    name: "Kolawole Bello",
    email: "stock.vi@web365.ng",
    phone: "0812 330 6671",
    password: "Admin@123",
    role: "STOCK_MANAGER",
    outletId: "outlet-3",
    outletIds: ["outlet-3"],
    status: "ACTIVE",
    createdAt: "2026-04-12T09:00:00.000Z",
  },
  {
    id: "user-12",
    staffId: "W365-0012",
    name: "Bisi Olaniyan",
    email: "staff.vi@web365.ng",
    phone: "0813 902 1184",
    password: "Admin@123",
    role: "STAFF",
    outletId: "outlet-3",
    outletIds: ["outlet-3"],
    status: "ACTIVE",
    createdAt: "2026-05-13T09:00:00.000Z",
  },
  {
    id: "user-13",
    staffId: "W365-0013",
    name: "Joy Nnaji",
    email: "relief@web365.ng",
    phone: "0816 245 7730",
    password: "Admin@123",
    role: "STAFF",
    outletId: "outlet-1",
    outletIds: ["outlet-1", "outlet-3"],
    status: "ACTIVE",
    createdAt: "2026-06-14T09:00:00.000Z",
  },
  {
    id: "user-14",
    staffId: "W365-0014",
    name: "Ifeanyi Nwosu",
    email: "warehouse@web365.ng",
    phone: "0803 410 2290",
    password: "Admin@123",
    role: "STOCK_MANAGER",
    outletId: "wh-1",
    outletIds: ["wh-1"],
    status: "ACTIVE",
    createdAt: "2026-07-15T09:00:00.000Z",
  },
]);

export const products: Product[] = persist("products", [
  {
    id: "prod-1",
    name: "Paracetamol 500mg",
    genericName: "Acetaminophen",
    category: "Tablets",
    manufacturer: "May & Baker",
    strength: "500mg",
    uom: "Pack",
    purchasePrice: 120,
    sellingPrice: 180,
    minStock: 200,
    stock: 390,
    status: "ACTIVE",
    barcode: "8901234567891",
    nafdacNumber: "A4-23412",
    outletId: "outlet-1",
    expiryWindow: "2 months",
  },
  {
    id: "prod-2",
    name: "Amoxicillin 250mg",
    genericName: "Amoxicillin",
    category: "Capsules",
    manufacturer: "EMZOR",
    strength: "250mg",
    uom: "Pack",
    purchasePrice: 420,
    sellingPrice: 600,
    minStock: 120,
    stock: 110,
    status: "LOW_STOCK",
    barcode: "8901234567907",
    nafdacNumber: "A4-56536",
    outletId: "outlet-2",
    expiryWindow: "1 month",
    rxOnly: true,
  },
  {
    id: "prod-3",
    name: "Cough Syrup",
    genericName: "Diphenhydramine",
    category: "Syrups",
    manufacturer: "Bioraj",
    strength: "100ml",
    uom: "Bottle",
    purchasePrice: 520,
    sellingPrice: 740,
    minStock: 80,
    stock: 180,
    status: "ACTIVE",
    barcode: "8901234567914",
    nafdacNumber: "A4-33370",
    outletId: "outlet-3",
    expiryWindow: "3 months",
  },
  {
    id: "prod-4",
    name: "Insulin Glargine",
    genericName: "Insulin",
    category: "Injections",
    manufacturer: "Novo Nordisk",
    strength: "100IU/ml",
    uom: "Box",
    purchasePrice: 9200,
    sellingPrice: 12500,
    minStock: 25,
    stock: 32,
    status: "ACTIVE",
    barcode: "8901234567921",
    nafdacNumber: "A4-44109",
    outletId: "outlet-1",
    expiryWindow: "5 months",
    rxOnly: true,
  },
  {
    id: "prod-5",
    name: "Hydrocortisone Cream",
    genericName: "Hydrocortisone",
    category: "Creams",
    manufacturer: "MobiCare",
    strength: "15g",
    uom: "Tube",
    purchasePrice: 300,
    sellingPrice: 460,
    minStock: 50,
    stock: 38,
    status: "LOW_STOCK",
    barcode: "8901234567938",
    nafdacNumber: "A4-99890",
    outletId: "outlet-2",
    expiryWindow: "1 month",
  },
  {
    id: "prod-6",
    name: "Surgical Gloves",
    genericName: "Nitrile Gloves",
    category: "Medical supplies",
    manufacturer: "Baxter",
    strength: "Medium",
    uom: "Box",
    purchasePrice: 2500,
    sellingPrice: 3600,
    minStock: 40,
    stock: 71,
    status: "ACTIVE",
    barcode: "8901234567945",
    nafdacNumber: "A4-12345",
    outletId: "outlet-3",
    expiryWindow: "6 months",
  },
  {
    id: "prod-7",
    name: "Tramadol 50mg",
    genericName: "Tramadol HCl",
    category: "Capsules",
    manufacturer: "Fidson",
    strength: "50mg",
    uom: "Pack",
    purchasePrice: 850,
    sellingPrice: 1300,
    minStock: 30,
    stock: 60,
    status: "ACTIVE",
    barcode: "8901234567952",
    nafdacNumber: "A4-77120",
    outletId: "outlet-3",
    expiryWindow: "10 months",
    rxOnly: true,
    controlled: true,
  },
  {
    id: "prod-8",
    name: "Artemether/Lumefantrine 80/480",
    genericName: "Artemether + Lumefantrine",
    category: "Tablets",
    manufacturer: "Swiss Pharma",
    strength: "80/480mg",
    uom: "Pack",
    purchasePrice: 1450,
    sellingPrice: 2200,
    minStock: 60,
    stock: 140,
    status: "ACTIVE",
    barcode: "8901234567969",
    nafdacNumber: "A4-10872",
    outletId: "outlet-1",
    expiryWindow: "14 months",
  },
  {
    id: "prod-9",
    name: "Metformin 500mg",
    genericName: "Metformin HCl",
    category: "Tablets",
    manufacturer: "Emzor",
    strength: "500mg",
    uom: "Pack",
    purchasePrice: 380,
    sellingPrice: 650,
    minStock: 80,
    stock: 220,
    status: "ACTIVE",
    barcode: "8901234567976",
    nafdacNumber: "A4-31190",
    outletId: "outlet-2",
    expiryWindow: "12 months",
    rxOnly: true,
  },
  {
    id: "prod-10",
    name: "Vitamin C 1000mg",
    genericName: "Ascorbic Acid",
    category: "Supplements",
    manufacturer: "Vitabiotics",
    strength: "1000mg",
    uom: "Tube",
    purchasePrice: 900,
    sellingPrice: 1500,
    minStock: 50,
    stock: 300,
    status: "ACTIVE",
    barcode: "8901234567983",
    nafdacNumber: "Pending",
    outletId: "outlet-3",
    expiryWindow: "18 months",
  },
  {
    id: "prod-11",
    name: "Paracetamol 500mg",
    genericName: "Acetaminophen",
    category: "Tablets",
    manufacturer: "May & Baker",
    strength: "500mg",
    uom: "Pack",
    purchasePrice: 120,
    sellingPrice: 180,
    minStock: 500,
    stock: 1600,
    status: "ACTIVE",
    barcode: "8901234567891",
    nafdacNumber: "A4-23412",
    outletId: "wh-1",
    expiryWindow: "12+ months",
  },
  {
    id: "prod-12",
    name: "Metformin 500mg",
    genericName: "Metformin HCl",
    category: "Tablets",
    manufacturer: "Emzor",
    strength: "500mg",
    uom: "Pack",
    purchasePrice: 380,
    sellingPrice: 650,
    minStock: 300,
    stock: 900,
    status: "ACTIVE",
    barcode: "8901234567976",
    nafdacNumber: "A4-31190",
    outletId: "wh-1",
    expiryWindow: "12+ months",
    rxOnly: true,
  },
  {
    id: "prod-13",
    name: "Artemether/Lumefantrine 80/480",
    genericName: "Artemether + Lumefantrine",
    category: "Tablets",
    manufacturer: "Swiss Pharma",
    strength: "80/480mg",
    uom: "Pack",
    purchasePrice: 1450,
    sellingPrice: 2200,
    minStock: 200,
    stock: 260,
    status: "ACTIVE",
    barcode: "8901234567969",
    nafdacNumber: "A4-10872",
    outletId: "wh-1",
    expiryWindow: "12+ months",
  },
  {
    id: "prod-14",
    name: "Surgical Gloves",
    genericName: "Nitrile Gloves",
    category: "Medical supplies",
    manufacturer: "Baxter",
    strength: "Medium",
    uom: "Box",
    purchasePrice: 2500,
    sellingPrice: 3600,
    minStock: 100,
    stock: 420,
    status: "ACTIVE",
    barcode: "8901234567945",
    nafdacNumber: "A4-12345",
    outletId: "wh-1",
    expiryWindow: "12+ months",
  },
]);

export const batches: BatchRecord[] = persist("batches", [
  {
    id: "batch-1",
    batchNumber: "PAR-2101",
    productId: "prod-1",
    productName: "Paracetamol 500mg",
    supplier: "Medi Supply Ltd.",
    assignedOutletId: "outlet-1",
    receivingDate: "2025-10-14",
    manufacturingDate: "2025-01-08",
    expiryDate: "2026-06-18",
    quantityReceived: 500,
    availableQuantity: 240,
    purchasePrice: 120,
  },
  {
    id: "batch-2",
    batchNumber: "PAR-2204",
    productId: "prod-1",
    productName: "Paracetamol 500mg",
    supplier: "Medi Supply Ltd.",
    assignedOutletId: "outlet-1",
    receivingDate: "2026-02-20",
    manufacturingDate: "2025-11-10",
    expiryDate: "2026-11-30",
    quantityReceived: 250,
    availableQuantity: 150,
    purchasePrice: 135,
  },
  {
    id: "batch-3",
    batchNumber: "AMX-3302",
    productId: "prod-2",
    productName: "Amoxicillin 250mg",
    supplier: "Healthcore Plus",
    assignedOutletId: "outlet-2",
    receivingDate: "2026-03-08",
    manufacturingDate: "2025-01-09",
    expiryDate: "2026-07-28",
    quantityReceived: 150,
    availableQuantity: 75,
    purchasePrice: 420,
  },
  {
    id: "batch-4",
    batchNumber: "INS-4708",
    productId: "prod-4",
    productName: "Insulin Glargine",
    supplier: "PharmaCore Med",
    assignedOutletId: "outlet-1",
    receivingDate: "2026-04-12",
    manufacturingDate: "2025-02-21",
    expiryDate: "2027-01-15",
    quantityReceived: 40,
    availableQuantity: 28,
    purchasePrice: 9200,
  },
  {
    id: "batch-5",
    batchNumber: "HYC-5924",
    productId: "prod-5",
    productName: "Hydrocortisone Cream",
    supplier: "Medi Supply Ltd.",
    assignedOutletId: "outlet-2",
    receivingDate: "2026-03-22",
    manufacturingDate: "2025-04-15",
    expiryDate: "2026-08-11",
    quantityReceived: 60,
    availableQuantity: 22,
    purchasePrice: 300,
  },
  {
    id: "batch-6",
    batchNumber: "AMX-3418",
    productId: "prod-2",
    productName: "Amoxicillin 250mg",
    supplier: "Healthcore Plus",
    assignedOutletId: "outlet-2",
    receivingDate: "2026-09-02",
    manufacturingDate: "2026-03-11",
    expiryDate: "2027-05-30",
    quantityReceived: 60,
    availableQuantity: 35,
    purchasePrice: 430,
  },
  {
    id: "batch-7",
    batchNumber: "CSY-1180",
    productId: "prod-3",
    productName: "Cough Syrup",
    supplier: "Bioraj Distribution",
    assignedOutletId: "outlet-3",
    receivingDate: "2026-08-19",
    manufacturingDate: "2026-02-01",
    expiryDate: "2027-03-14",
    quantityReceived: 200,
    availableQuantity: 180,
    purchasePrice: 520,
  },
  {
    id: "batch-8",
    batchNumber: "INS-4790",
    productId: "prod-4",
    productName: "Insulin Glargine",
    supplier: "PharmaCore Med",
    assignedOutletId: "outlet-1",
    receivingDate: "2026-10-03",
    manufacturingDate: "2026-04-12",
    expiryDate: "2027-04-02",
    quantityReceived: 10,
    availableQuantity: 4,
    purchasePrice: 9300,
  },
  {
    id: "batch-9",
    batchNumber: "HYC-6011",
    productId: "prod-5",
    productName: "Hydrocortisone Cream",
    supplier: "Medi Supply Ltd.",
    assignedOutletId: "outlet-2",
    receivingDate: "2026-09-21",
    manufacturingDate: "2026-03-05",
    expiryDate: "2027-02-27",
    quantityReceived: 20,
    availableQuantity: 16,
    purchasePrice: 300,
  },
  {
    id: "batch-10",
    batchNumber: "GLV-0921",
    productId: "prod-6",
    productName: "Surgical Gloves",
    supplier: "Baxter West Africa",
    assignedOutletId: "outlet-3",
    receivingDate: "2026-07-10",
    manufacturingDate: "2025-12-01",
    expiryDate: "2029-01-01",
    quantityReceived: 100,
    availableQuantity: 71,
    purchasePrice: 2500,
  },
  {
    id: "batch-11",
    batchNumber: "TRM-7720",
    productId: "prod-7",
    productName: "Tramadol 50mg",
    supplier: "PharmaCore Med",
    assignedOutletId: "outlet-3",
    receivingDate: "2026-09-15",
    manufacturingDate: "2026-03-30",
    expiryDate: "2027-09-30",
    quantityReceived: 80,
    availableQuantity: 60,
    purchasePrice: 850,
  },
  {
    id: "batch-12",
    batchNumber: "ART-5521",
    productId: "prod-8",
    productName: "Artemether/Lumefantrine 80/480",
    supplier: "Healthcore Plus",
    assignedOutletId: "outlet-1",
    receivingDate: "2026-10-11",
    manufacturingDate: "2026-05-02",
    expiryDate: "2028-01-31",
    quantityReceived: 200,
    availableQuantity: 140,
    purchasePrice: 1450,
  },
  {
    id: "batch-13",
    batchNumber: "MET-2290",
    productId: "prod-9",
    productName: "Metformin 500mg",
    supplier: "Medi Supply Ltd.",
    assignedOutletId: "outlet-2",
    receivingDate: "2026-10-20",
    manufacturingDate: "2026-06-14",
    expiryDate: "2027-12-31",
    quantityReceived: 300,
    availableQuantity: 220,
    purchasePrice: 380,
  },
  {
    id: "batch-14",
    batchNumber: "VTC-1003",
    productId: "prod-10",
    productName: "Vitamin C 1000mg",
    supplier: "Bioraj Distribution",
    assignedOutletId: "outlet-3",
    receivingDate: "2026-10-26",
    manufacturingDate: "2026-07-01",
    expiryDate: "2028-05-31",
    quantityReceived: 360,
    availableQuantity: 300,
    purchasePrice: 900,
  },
  {
    id: "batch-15",
    batchNumber: "WHP-2611",
    productId: "prod-11",
    productName: "Paracetamol 500mg",
    supplier: "Medi Supply Ltd.",
    assignedOutletId: "wh-1",
    receivingDate: "2026-10-18",
    manufacturingDate: "2026-04-01",
    expiryDate: "2027-10-31",
    quantityReceived: 2000,
    availableQuantity: 1600,
    purchasePrice: 120,
  },
  {
    id: "batch-16",
    batchNumber: "MET-2402",
    productId: "prod-12",
    productName: "Metformin 500mg",
    supplier: "Medi Supply Ltd.",
    assignedOutletId: "wh-1",
    receivingDate: "2026-10-18",
    manufacturingDate: "2026-04-01",
    expiryDate: "2028-02-28",
    quantityReceived: 1000,
    availableQuantity: 900,
    purchasePrice: 380,
  },
  {
    id: "batch-17",
    batchNumber: "ART-5590",
    productId: "prod-13",
    productName: "Artemether/Lumefantrine 80/480",
    supplier: "Healthcore Plus",
    assignedOutletId: "wh-1",
    receivingDate: "2026-10-18",
    manufacturingDate: "2026-04-01",
    expiryDate: "2028-03-31",
    quantityReceived: 400,
    availableQuantity: 260,
    purchasePrice: 1450,
  },
  {
    id: "batch-18",
    batchNumber: "GLV-1102",
    productId: "prod-14",
    productName: "Surgical Gloves",
    supplier: "Baxter West Africa",
    assignedOutletId: "wh-1",
    receivingDate: "2026-10-18",
    manufacturingDate: "2026-04-01",
    expiryDate: "2029-06-30",
    quantityReceived: 600,
    availableQuantity: 420,
    purchasePrice: 2500,
  },
]);

export const stockMovements: StockMovement[] = persist("stockMovements", [
  {
    id: "mov-1",
    reference: "GRN-1021",
    date: "2026-11-01",
    type: "Receive",
    outletId: "outlet-1",
    productName: "Paracetamol 500mg",
    quantity: 210,
    status: "Approved",
  },
  {
    id: "mov-2",
    reference: "ISS-9021",
    date: "2026-11-02",
    type: "Issue",
    outletId: "outlet-2",
    productName: "Amoxicillin 250mg",
    quantity: 38,
    status: "Approved",
  },
  {
    id: "mov-3",
    reference: "TRFR-6621",
    date: "2026-11-03",
    type: "Transfer",
    outletId: "outlet-3",
    productName: "Cough Syrup",
    quantity: 52,
    status: "Pending",
  },
  {
    id: "mov-4",
    reference: "ADJ-5213",
    date: "2026-11-04",
    type: "Adjustment",
    outletId: "outlet-1",
    productName: "Insulin Glargine",
    quantity: 4,
    status: "Approved",
  },
]);

export function getStockMovementsServer() {
  return [...stockMovements];
}

export function updateStockMovementStatus(id: string, status: "Approved" | "Rejected", approvedBy?: string) {
  const index = stockMovements.findIndex((movement) => movement.id === id);
  if (index === -1) return null;

  const current = stockMovements[index];
  const next = { ...current, status, approvedBy: approvedBy ?? current.approvedBy };

  // Stock itself changes only through the stock ledger (lib/erp/ledger.ts) when the movement is approved.
  stockMovements[index] = next;
  return stockMovements[index];
}

export function addStockMovement(input: Partial<StockMovement>) {
  const movement: StockMovement = {
    id: input.id ?? `mov-${Date.now()}`,
    reference: input.reference ?? `TRFR-${Date.now().toString().slice(-4)}`,
    date: input.date ?? new Date().toISOString().split("T")[0],
    type: input.type ?? "Transfer",
    outletId: input.outletId ?? "outlet-1",
    productName: input.productName ?? "New product",
    quantity: input.quantity ?? 0,
    status: input.status ?? "Pending",
    toOutletId: input.toOutletId,
    productId: input.productId,
    direction: input.direction,
    invoiceNumber: input.invoiceNumber,
    purchaseReference: input.purchaseReference,
    batchId: input.batchId,
    disposition: input.disposition,
    reason: input.reason,
    requestedBy: input.requestedBy,
    approvedBy: input.approvedBy,
  };

  stockMovements.unshift(movement);
  return movement;
}

export function getDashboardSnapshot() {
  const totalStock = products.reduce((sum, product) => sum + product.stock, 0);
  const stockValue = products.reduce((sum, product) => sum + product.stock * product.sellingPrice, 0);
  const monthlySales = 2456000;
  const todaySales = 318400;
  const lowStock = products.filter((product) => product.status === "LOW_STOCK");
  const expiring = batches.filter((batch) => {
    const date = new Date(batch.expiryDate);
    const now = new Date();
    return date.getTime() - now.getTime() < 1000 * 60 * 60 * 24 * 90;
  });

  const salesByOutlet = outlets.filter((outlet) => outlet.type !== "WAREHOUSE").map((outlet) => ({
    name: outlet.name,
    value: outlet.sales,
  }));

  const salesTrend = [
    { month: "Jan", sales: 760000 },
    { month: "Feb", sales: 820000 },
    { month: "Mar", sales: 980000 },
    { month: "Apr", sales: 1040000 },
    { month: "May", sales: 1180000 },
    { month: "Jun", sales: 1260000 },
    { month: "Jul", sales: 1410000 },
    { month: "Aug", sales: 1530000 },
  ];

  return {
    totalProducts: products.length,
    totalStock,
    stockValue,
    todaySales,
    monthlySales,
    lowStock,
    expiring,
    salesByOutlet,
    salesTrend,
    recentTransactions: stockMovements,
    recentTransfers: stockMovements.filter((movement) => movement.type === "Transfer"),
  };
}

export async function findUserByCredentials(email: string, password: string) {
  const matchedUser = users.find(
    (user) =>
      user.email.toLowerCase() === email.toLowerCase() &&
      (user.password === password || verifyPassword(password, user.passwordHash ?? null)),
  );

  return matchedUser ?? null;
}

export function getUsers() {
  return users;
}

export async function getUsersServer() {
  return users;
}

export function getProducts() {
  return [...products];
}



export async function getProductsServer() {
  return products;
}

export function getOutlets() {
  return outlets;
}

export async function getOutletsServer() {
  return outlets;
}

export async function getBatchesServer() {
  return [...batches];
}

export function getBatches() {
  return batches;
}

export function getStockMovements() {
  return stockMovements;
}



export function getOutletById(outletId: string | null) {
  if (!outletId) return null;
  return outlets.find((outlet) => outlet.id === outletId) ?? null;
}

export function getProductById(productId: string) {
  return products.find((product) => product.id === productId) ?? null;
}
