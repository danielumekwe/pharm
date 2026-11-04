// In-memory ERP store used when no database is configured. Kept on globalThis so data
// survives hot reloads and is shared by pages and route handlers in the same process.

import { products } from "@/lib/data";
import { DATA_VERSION } from "@/lib/data-version";
import type {
  ImpersonationSession,
  SaleReturn,
  AppNotification,
  DeviceRegistration,
  InventoryAlert,
  NotificationDelivery,
  AuditEvent,
  ProductRegistration,
  RegulatoryDocument,
  SystemSettings,
  Customer,
  Expense,
  Payment,
  PaymentMethod,
  PurchaseOrder,
  SaleInvoice,
  Supplier,
} from "@/lib/erp/types";

export type ErpStore = {
  customers: Customer[];
  suppliers: Supplier[];
  sales: SaleInvoice[];
  purchaseOrders: PurchaseOrder[];
  payments: Payment[];
  expenses: Expense[];
  audit: AuditEvent[];
  settings: SystemSettings;
  registrations: ProductRegistration[];
  documents: RegulatoryDocument[];
  alerts: InventoryAlert[];
  notifications: AppNotification[];
  deliveries: NotificationDelivery[];
  devices: DeviceRegistration[];
  saleReturns: SaleReturn[];
  impersonations: ImpersonationSession[];
  /** Last run markers for scheduled jobs (daily: YYYY-MM-DD, monthly: YYYY-MM). */
  jobRuns: { daily?: string; monthly?: string };
  counters: Record<string, number>;
};

export const DEFAULT_SETTINGS: SystemSettings = {
  businessName: "Pharmacy ERP",
  vatRate: 7.5,
  minShelfLifeDays: 180,
  nearExpiryDays: 150,
  expiryIntervals: [150, 120, 90, 60, 30],
  criticalShortagePct: 50,
  dailySummaryHour: 7,
  impersonation: { enabled: false, onDisable: "terminate", maxMinutes: 30 },
  lowStock: { defaultMin: 20, outletMins: {}, productMins: {} },
  alertEmail: { enabled: true, recipients: [], notifyManagers: true, lowStockImmediate: true, criticalImmediate: true, dailySummary: true, maxRetries: 3 },
  inviteValidityHours: 72,
  supplierPaymentApprovalThreshold: 1_000_000,
  passwordMinLength: 8,
};

function seedRegistrations(): ProductRegistration[] {
  // One registration per product (registrations are national, not per outlet).
  const seen = new Map<string, (typeof products)[number]>();
  for (const product of products) if (!seen.has(product.name)) seen.set(product.name, product);
  const expiries: Record<string, string> = {
    "Paracetamol 500mg": "2029-03-14",
    "Amoxicillin 250mg": "2026-12-20",
    "Cough Syrup": "2027-06-30",
    "Insulin Glargine": "2028-09-01",
    "Hydrocortisone Cream": "2026-10-15",
    "Surgical Gloves": "2030-01-31",
    "Tramadol 50mg": "2027-01-28",
    "Artemether/Lumefantrine 80/480": "2029-11-30",
    "Metformin 500mg": "2028-05-17",
  };
  return [...seen.values()].map((product, index) => {
    const expiryDate = expiries[product.name] ?? "";
    const issued = expiryDate ? `${Number(expiryDate.slice(0, 4)) - 5}${expiryDate.slice(4)}` : "";
    return {
      id: `reg-${index + 1}`,
      productName: product.name,
      genericName: product.genericName,
      manufacturer: product.manufacturer,
      category: product.category === "Medical supplies" ? "Medical device" : product.category === "Supplements" ? "Supplement" : "Drug",
      nafdacNumber: product.nafdacNumber,
      issuedDate: issued,
      expiryDate,
      notes: product.nafdacNumber === "Pending" ? "Application submitted to NAFDAC; awaiting approval." : undefined,
      updatedBy: "Dr. Kemi Oladipo",
      updatedAt: daysAgo(40 - index * 3),
    };
  });
}

const DAY = 1000 * 60 * 60 * 24;

function daysAgo(days: number, hour = 10) {
  const date = new Date(Date.now() - days * DAY);
  date.setHours(hour, (days * 17) % 60, 0, 0);
  return date.toISOString();
}

function isoDate(value: string) {
  return value.slice(0, 10);
}

/** Small deterministic PRNG so seeded history is stable within a process. */
function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export const VAT_RATE = 0.075; // seed history only; live sales use settings.vatRate

function seedCustomers(): Customer[] {
  const rows: Omit<Customer, "id" | "code" | "createdAt">[] = [
    { name: "Walk-in customer", type: "Walk-in", phone: "-", email: "-", outletId: null, creditLimit: 0, balance: 0, status: "Active" },
    { name: "Reddington Clinic", type: "Clinic", phone: "0803 555 1021", email: "procurement@reddington.ng", outletId: "outlet-3", creditLimit: 1500000, balance: 0, status: "Active" },
    { name: "AXA Mansard HMO", type: "HMO", phone: "0700 292 6267", email: "claims@axamansard.ng", outletId: null, creditLimit: 3000000, balance: 0, status: "Active" },
    { name: "Hygeia HMO", type: "HMO", phone: "0700 494 4342", email: "providers@hygeiahmo.ng", outletId: null, creditLimit: 2500000, balance: 0, status: "Active" },
    { name: "Dangote Staff Clinic", type: "Corporate", phone: "0809 112 4400", email: "clinic@dangote.ng", outletId: "outlet-2", creditLimit: 2000000, balance: 0, status: "Active" },
    { name: "Mrs. Folake Adeyemi", type: "Retail", phone: "0812 334 9087", email: "folake.a@gmail.com", outletId: "outlet-1", creditLimit: 50000, balance: 0, status: "Active" },
    { name: "Mr. Ibrahim Sule", type: "Retail", phone: "0705 221 7812", email: "isule@yahoo.com", outletId: "outlet-2", creditLimit: 30000, balance: 0, status: "Active" },
    { name: "Lekki Wellness Centre", type: "Clinic", phone: "0816 404 2210", email: "admin@lekkiwellness.ng", outletId: "outlet-1", creditLimit: 800000, balance: 0, status: "On hold" },
  ];
  return rows.map((row, index) => ({
    ...row,
    id: `cus-${index + 1}`,
    code: `CUS-${String(index + 1).padStart(4, "0")}`,
    createdAt: daysAgo(200 - index * 9),
  }));
}

function seedSuppliers(): Supplier[] {
  const rows: Omit<Supplier, "id" | "code">[] = [
    { name: "Medi Supply Ltd.", contactPerson: "Kunle Ajayi", phone: "0802 441 2290", email: "orders@medisupply.ng", pcnLicense: "PCN/WS/2026/0412", paymentTermsDays: 30, balance: 0, status: "Approved", categories: "Analgesics, Antidiabetics, Topicals" },
    { name: "Healthcore Plus", contactPerson: "Ngozi Obi", phone: "0803 778 1102", email: "sales@healthcoreplus.ng", pcnLicense: "PCN/WS/2026/0388", paymentTermsDays: 45, balance: 0, status: "Approved", categories: "Antibiotics, Antimalarials" },
    { name: "PharmaCore Med", contactPerson: "Segun Bakare", phone: "0809 551 7743", email: "trade@pharmacoremed.com", pcnLicense: "PCN/WS/2026/0157", paymentTermsDays: 30, balance: 0, status: "Approved", categories: "Insulin, Controlled drugs, Cold-chain" },
    { name: "Bioraj Distribution", contactPerson: "Hauwa Musa", phone: "0701 882 3311", email: "info@bioraj.ng", pcnLicense: "PCN/WS/2026/0590", paymentTermsDays: 21, balance: 0, status: "Approved", categories: "Syrups, Supplements" },
    { name: "Baxter West Africa", contactPerson: "Emeka Udeh", phone: "0814 220 9981", email: "wa.orders@baxter.com", pcnLicense: "PCN/WS/2026/0071", paymentTermsDays: 60, balance: 0, status: "Approved", categories: "Medical consumables" },
    { name: "Unity Generics", contactPerson: "Bola Tinubu-Ade", phone: "0806 331 4520", email: "hello@unitygenerics.ng", pcnLicense: "Pending", paymentTermsDays: 14, balance: 0, status: "Pending verification", categories: "Generics" },
  ];
  return rows.map((row, index) => ({ ...row, id: `sup-${index + 1}`, code: `SUP-${String(index + 1).padStart(4, "0")}` }));
}

function seedSales(customers: Customer[]): { sales: SaleInvoice[]; payments: Payment[] } {
  const random = prng(365);
  const cashiers: Record<string, string> = {
    "outlet-1": "Grace Udo",
    "outlet-2": "Chinedu Okafor",
    "outlet-3": "Maryam Yusuf",
  };
  const sellable = products.filter((product) => product.outletId.startsWith("outlet-"));
  const sales: SaleInvoice[] = [];
  const payments: Payment[] = [];
  let counter = 1;

  for (let day = 29; day >= 0; day -= 1) {
    // Roughly 15–20 invoices per outlet per day, typical for a busy Lagos community pharmacy.
    const perDay = 45 + Math.floor(random() * 16);
    for (let n = 0; n < perDay; n += 1) {
      const outletId = `outlet-${1 + Math.floor(random() * 3)}`;
      const options = sellable.filter((product) => product.outletId === outletId);
      if (options.length === 0) continue;

      const lineCount = 1 + Math.floor(random() * Math.min(3, options.length));
      const picked = [...options].sort(() => random() - 0.5).slice(0, lineCount);
      const lines = picked.map((product) => {
        const quantity = 1 + Math.floor(random() * (product.sellingPrice > 5000 ? 2 : 6));
        return {
          productId: product.id,
          productName: product.name,
          batchNumbers: [],
          quantity,
          unitPrice: product.sellingPrice,
          discount: 0,
          total: quantity * product.sellingPrice,
        };
      });

      const roll = random();
      const institutional = customers.filter(
        (customer) => customer.type !== "Walk-in" && customer.type !== "Retail" && (customer.outletId === null || customer.outletId === outletId),
      );
      const customer = roll > 0.82 && institutional.length ? institutional[Math.floor(random() * institutional.length)] : customers[0];
      const method: PaymentMethod =
        customer.type === "HMO" ? "HMO" : customer.type === "Walk-in" ? (["Cash", "Card", "Transfer"] as const)[Math.floor(random() * 3)] : "Credit";

      const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
      const vat = Math.round(subtotal * VAT_RATE);
      const total = subtotal + vat;
      const settled = method === "Cash" || method === "Card" || method === "Transfer" || day > 20;
      const amountPaid = settled ? total : 0;
      const voided = random() > 0.97;
      const date = daysAgo(day, 8 + Math.floor(random() * 11));
      const number = `INV-${String(counter).padStart(5, "0")}`;

      sales.push({
        id: `sale-${counter}`,
        number,
        date,
        outletId,
        customerId: customer.id,
        customerName: customer.name,
        cashier: cashiers[outletId],
        lines,
        subtotal,
        discount: 0,
        vat,
        total,
        amountPaid: voided ? 0 : amountPaid,
        paymentMethod: method,
        status: voided ? "Voided" : amountPaid >= total ? "Paid" : "Unpaid",
        prescriptionRef: lines.some((line) => products.find((product) => product.id === line.productId)?.rxOnly)
          ? `RX-${Math.floor(100000 + random() * 899999)}`
          : undefined,
        voidReason: voided ? "Wrong item scanned" : undefined,
      });

      if (!voided && amountPaid > 0) {
        payments.push({
          id: `pay-in-${counter}`,
          reference: `RCT-${String(counter).padStart(5, "0")}`,
          date,
          direction: "IN",
          partyType: "Customer",
          partyId: customer.id,
          partyName: customer.name,
          documentRef: number,
          method: method === "Credit" ? "Transfer" : (method as Payment["method"]),
          account: method === "Cash" ? "Cash till" : method === "Card" ? "POS settlement ••0912" : "GTBank ••2231",
          amount: amountPaid,
          recordedBy: cashiers[outletId],
        });
      }

      if (!voided && amountPaid < total) {
        customer.balance += total - amountPaid;
      }

      counter += 1;
    }
  }

  return { sales: sales.reverse(), payments };
}

function seedPurchaseOrders(suppliers: Supplier[]): PurchaseOrder[] {
  const find = (id: string) => products.find((product) => product.id === id)!;
  const line = (productId: string, quantity: number, received = 0) => {
    const product = find(productId);
    return { productId, productName: product.name, quantity, unitCost: product.purchasePrice, receivedQuantity: received };
  };
  const orders: Omit<PurchaseOrder, "total" | "supplierName">[] = [
    { id: "po-1", number: "PO-2026-0141", supplierId: "sup-1", outletId: "wh-1", createdAt: daysAgo(21), expectedDate: isoDate(daysAgo(14)), createdBy: "Chinedu Okafor", createdById: "user-3", approvedBy: "Blessing Eze", status: "Received", lines: [line("prod-1", 400, 400), line("prod-9", 200, 200)], amountPaid: 0 },
    { id: "po-2", number: "PO-2026-0142", supplierId: "sup-2", outletId: "outlet-2", createdAt: daysAgo(12), expectedDate: isoDate(daysAgo(5)), createdBy: "Chinedu Okafor", createdById: "user-3", approvedBy: "Blessing Eze", status: "Partially received", lines: [line("prod-2", 150, 60), line("prod-8", 120, 0)], amountPaid: 0 },
    { id: "po-3", number: "PO-2026-0143", supplierId: "sup-3", outletId: "outlet-1", createdAt: daysAgo(6), expectedDate: isoDate(daysAgo(-3)), createdBy: "Aisha Bello", createdById: "user-6", approvedBy: "Blessing Eze", status: "Approved", lines: [line("prod-4", 30), line("prod-7", 40)], amountPaid: 0 },
    { id: "po-4", number: "PO-2026-0144", supplierId: "sup-4", outletId: "outlet-3", createdAt: daysAgo(3), expectedDate: isoDate(daysAgo(-7)), createdBy: "Chinedu Okafor", createdById: "user-3", status: "Pending approval", lines: [line("prod-3", 120), line("prod-10", 200)], amountPaid: 0, notes: "Harmattan season cough & cold uplift" },
    { id: "po-5", number: "PO-2026-0145", supplierId: "sup-5", outletId: "wh-1", createdAt: daysAgo(2), expectedDate: isoDate(daysAgo(-10)), createdBy: "Chinedu Okafor", createdById: "user-3", status: "Pending approval", lines: [line("prod-6", 80)], amountPaid: 0 },
    { id: "po-6", number: "PO-2026-0146", supplierId: "sup-1", outletId: "outlet-2", createdAt: daysAgo(1), expectedDate: isoDate(daysAgo(-6)), createdBy: "Chinedu Okafor", createdById: "user-3", status: "Draft", lines: [line("prod-5", 60)], amountPaid: 0 },
    { id: "po-7", number: "PO-2026-0139", supplierId: "sup-6", outletId: "outlet-1", createdAt: daysAgo(26), expectedDate: isoDate(daysAgo(19)), createdBy: "Aisha Bello", createdById: "user-6", status: "Cancelled", lines: [line("prod-8", 50)], amountPaid: 0, notes: "Supplier PCN licence not verified" },
  ];

  return orders.map((order) => {
    const supplier = suppliers.find((row) => row.id === order.supplierId)!;
    const total = order.lines.reduce((sum, row) => sum + row.quantity * row.unitCost, 0);
    const receivedValue = order.lines.reduce((sum, row) => sum + row.receivedQuantity * row.unitCost, 0);
    supplier.balance += receivedValue;
    return { ...order, supplierName: supplier.name, total };
  });
}

function seedExpenses(): Expense[] {
  const rows: [string, string, string, string, number, Expense["status"], string, string][] = [
    ["Generator & Diesel", "Diesel - 400L for generator", "Total Energies", "outlet-1", 520000, "Paid", "Aisha Bello", "user-6"],
    ["Utilities", "Ikeja Electric prepaid units", "IKEDC", "outlet-2", 185000, "Paid", "Chinedu Okafor", "user-3"],
    ["Cold-chain", "Vaccine fridge compressor service", "CoolTech Services", "outlet-1", 95000, "Approved", "Aisha Bello", "user-6"],
    ["Logistics", "Warehouse → outlet dispatch (Oct)", "GIG Logistics", "wh-1", 240000, "Approved", "Chinedu Okafor", "user-3"],
    ["Regulatory fees", "PCN premises licence renewal - VI", "Pharmacists Council of Nigeria", "outlet-3", 150000, "Submitted", "Maryam Yusuf", "user-2"],
    ["Staff welfare", "Monthly staff lunch", "Chicken Republic", "outlet-3", 68000, "Submitted", "Maryam Yusuf", "user-2"],
    ["Maintenance", "Shelf & signage repairs", "Lagos Fitters", "outlet-2", 112000, "Rejected", "Chinedu Okafor", "user-3"],
    ["Rent", "Q4 shop rent - Lekki", "Prime Estates", "outlet-1", 3500000, "Paid", "Blessing Eze", "user-2"],
    ["Bank charges", "POS & transfer charges (Oct)", "GTBank", "outlet-1", 41200, "Paid", "Blessing Eze", "user-2"],
    ["Marketing", "Free BP screening flyers", "PrintHub", "outlet-2", 45000, "Submitted", "Chinedu Okafor", "user-3"],
  ];
  return rows.map(([category, description, vendor, outletId, amount, status, requestedBy, requestedById], index) => ({
    id: `exp-${index + 1}`,
    reference: `EXP-${String(1040 + index).padStart(5, "0")}`,
    date: isoDate(daysAgo(28 - index * 3)),
    category,
    description,
    vendor,
    outletId,
    amount,
    status,
    requestedBy,
    requestedById,
    approvedBy: status === "Submitted" ? undefined : "Blessing Eze",
  }));
}

function seedAudit(): AuditEvent[] {
  const rows: [number, string, string, string, string, string, string, string, string | null, AuditEvent["severity"]][] = [
    [0, "user-3", "Chinedu Okafor", "STOCK_MANAGER", "stock.request", "StockMovement", "mov-3", "Requested transfer of 52 × Cough Syrup to Outlet 3", "outlet-3", "info"],
    [1, "user-5", "Dr. Kemi Oladipo", "REGULATORY_OFFICER", "compliance.flag", "Batch", "batch-1", "Batch PAR-2101 past expiry with 240 units on hand — quarantine required", "outlet-1", "critical"],
    [1, "user-2", "Blessing Eze", "PHARMACY_MANAGER", "purchase.approve", "PurchaseOrder", "po-3", "Approved PO-2026-0143 (PharmaCore Med)", "outlet-1", "info"],
    [2, "user-6", "Aisha Bello", "SALES_MANAGER", "stock.approve", "StockMovement", "mov-4", "Approved adjustment of 4 × Insulin Glargine (cold-chain breach)", "outlet-1", "warning"],
    [3, "user-1", "Amina Adewale", "SUPER_ADMIN", "users.update", "User", "user-4", "Assigned Grace Udo to Outlet 1 - Lekki as Staff", "outlet-1", "info"],
    [5, "user-3", "Chinedu Okafor", "STOCK_MANAGER", "purchase.receive", "PurchaseOrder", "po-2", "Received 60 × Amoxicillin 250mg against PO-2026-0142", "outlet-2", "info"],
    [8, "user-2", "Blessing Eze", "PHARMACY_MANAGER", "purchase.cancel", "PurchaseOrder", "po-7", "Cancelled PO-2026-0139 — supplier licence unverified", "outlet-1", "warning"],
  ];
  return rows.map(([days, actorId, actorName, actorRole, action, entity, entityId, summary, outletId, severity], index) => ({
    id: `aud-seed-${index + 1}`,
    at: daysAgo(days, 9 + index),
    actorId,
    actorName,
    actorRole,
    action,
    entity,
    entityId,
    summary,
    outletId,
    severity,
  }));
}

function createStore(): ErpStore {
  const customers = seedCustomers();
  const suppliers = seedSuppliers();
  const { sales, payments } = seedSales(customers);
  const purchaseOrders = seedPurchaseOrders(suppliers);
  const expenses = seedExpenses();

  for (const expense of expenses.filter((row) => row.status === "Paid")) {
    payments.push({
      id: `pay-out-${expense.id}`,
      reference: `PV-${expense.reference.slice(4)}`,
      date: `${expense.date}T12:00:00.000Z`,
      direction: "OUT",
      partyType: "Expense",
      partyId: expense.id,
      partyName: expense.vendor,
      documentRef: expense.reference,
      method: "Transfer",
      account: "GTBank ••2231",
      amount: expense.amount,
      recordedBy: "Blessing Eze",
    });
  }

  payments.sort((a, b) => b.date.localeCompare(a.date));

  return {
    customers,
    suppliers,
    sales,
    purchaseOrders,
    payments,
    expenses,
    audit: seedAudit(),
    settings: { ...DEFAULT_SETTINGS },
    registrations: seedRegistrations(),
    documents: [],
    alerts: [],
    notifications: [],
    deliveries: [],
    devices: [],
    saleReturns: [],
    impersonations: [],
    jobRuns: {},
    counters: {
      sale: sales.length + 1,
      po: 147,
      payment: payments.length + 1,
      expense: 1050,
      customer: customers.length + 1,
      supplier: suppliers.length + 1,
      audit: 1,
      movement: 7000,
    },
  };
}

const STORE_KEY = `__pharmErpStore_v${DATA_VERSION}`;
const globalStore = globalThis as typeof globalThis & Record<string, ErpStore | undefined>;

export function getStore(): ErpStore {
  let store = globalStore[STORE_KEY];
  if (!store) {
    store = createStore();
    globalStore[STORE_KEY] = store;
  }
  // Backfill sections added after the store was created (defensive for long-running dev servers).
  store.settings ??= { ...DEFAULT_SETTINGS };
  store.registrations ??= seedRegistrations();
  store.documents ??= [];
  store.alerts ??= [];
  store.notifications ??= [];
  store.deliveries ??= [];
  store.devices ??= [];
  store.saleReturns ??= [];
  store.impersonations ??= [];
  store.settings.impersonation ??= { ...DEFAULT_SETTINGS.impersonation };
  store.settings.lowStock ??= { ...DEFAULT_SETTINGS.lowStock, outletMins: {}, productMins: {} };
  store.settings.alertEmail ??= { ...DEFAULT_SETTINGS.alertEmail, recipients: [] };
  store.jobRuns ??= {};
  store.settings.expiryIntervals ??= [...DEFAULT_SETTINGS.expiryIntervals];
  store.settings.criticalShortagePct ??= DEFAULT_SETTINGS.criticalShortagePct;
  store.settings.dailySummaryHour ??= DEFAULT_SETTINGS.dailySummaryHour;
  return store;
}

export function nextNumber(key: string) {
  const store = getStore();
  const value = store.counters[key] ?? 1;
  store.counters[key] = value + 1;
  return value;
}
