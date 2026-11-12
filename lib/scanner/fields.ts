// AI Document Scanner: what is read from each kind of paper record, how confident the reading is, and the
// checks a record must pass before it can be approved. Pure module (client + server, unit-tested).
//
// Rules:
// - A value the AI could not read stays blank ("not detected"); nothing is guessed or filled in here.
// - Low-confidence values block approval until a person corrects or confirms them.
// - Abbreviations are expanded only when they are unambiguous (Tab → Tablet); the text as written is kept.

import { parseDate, parseNumber, type DateFormat } from "@/lib/erp/import-format";

export const SCAN_CATEGORIES = ["inventory", "sales", "expenses", "suppliers"] as const;
export type ScanCategory = (typeof SCAN_CATEGORIES)[number];

export const RECORD_KINDS = ["inventory", "sale", "daily_sales", "expense", "supplier"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const CATEGORY_KINDS: Record<ScanCategory, RecordKind[]> = {
  inventory: ["inventory"],
  sales: ["sale", "daily_sales"],
  expenses: ["expense"],
  suppliers: ["supplier"],
};

export const CATEGORY_LABELS: Record<ScanCategory, string> = {
  inventory: "Inventory records",
  sales: "Historical sales records",
  expenses: "Expense records",
  suppliers: "Supplier records",
};

export const KIND_LABELS: Record<RecordKind, string> = {
  inventory: "Stock item",
  sale: "Sale (line of a receipt or sales book)",
  daily_sales: "Daily sales total",
  expense: "Expense",
  supplier: "Supplier",
};

/** "confirmed": a person typed or confirmed the value. "none": the AI found nothing (field left blank). */
export type Confidence = "high" | "medium" | "low" | "none" | "confirmed";
export type FieldValue = { value: string; confidence: Confidence; /** Text exactly as written on the page. */ read?: string };
export type Fields = Record<string, FieldValue>;

type FieldType = "text" | "money" | "integer" | "date";
export type FieldDef = { key: string; label: string; type: FieldType; required?: boolean; hint: string };

export const KIND_FIELDS: Record<RecordKind, FieldDef[]> = {
  inventory: [
    { key: "name", label: "Product name", type: "text", required: true, hint: "Name as written, including brand where shown" },
    { key: "genericName", label: "Generic name", type: "text", hint: "Active ingredient, only when written" },
    { key: "strength", label: "Strength", type: "text", hint: "e.g. 500mg, 250mg/5ml" },
    { key: "dosageForm", label: "Dosage form", type: "text", hint: "Tablet, Capsule, Syrup…" },
    { key: "category", label: "Category", type: "text", hint: "e.g. Analgesics" },
    { key: "brand", label: "Brand / manufacturer", type: "text", hint: "" },
    { key: "packSize", label: "Pack size", type: "integer", hint: "Units in one pack" },
    { key: "quantity", label: "Quantity", type: "integer", hint: "Count in stock" },
    { key: "quantityUnit", label: "Quantity unit", type: "text", hint: "What the quantity counts (Carton, Pack, Tablet)" },
    { key: "purchasePrice", label: "Purchase price (₦)", type: "money", hint: "Cost price" },
    { key: "sellingPrice", label: "Selling price (₦)", type: "money", hint: "Retail price" },
    { key: "batchNumber", label: "Batch number", type: "text", hint: "" },
    { key: "expiryDate", label: "Expiry date", type: "date", hint: "" },
    { key: "manufacturingDate", label: "Manufacturing date", type: "date", hint: "" },
    { key: "supplier", label: "Supplier", type: "text", hint: "" },
    { key: "barcode", label: "Barcode", type: "text", hint: "" },
    { key: "reorderLevel", label: "Reorder level", type: "integer", hint: "" },
    { key: "nafdacNumber", label: "NAFDAC number", type: "text", hint: "e.g. A4-12345" },
  ],
  sale: [
    { key: "date", label: "Transaction date", type: "date", required: true, hint: "Date of the sale (not an expiry date)" },
    { key: "receiptNumber", label: "Receipt number", type: "text", hint: "Lines with the same date and receipt number form one sale" },
    { key: "productName", label: "Product", type: "text", required: true, hint: "" },
    { key: "quantity", label: "Quantity sold", type: "integer", required: true, hint: "" },
    { key: "unitPrice", label: "Unit price (₦)", type: "money", hint: "" },
    { key: "discount", label: "Discount (₦)", type: "money", hint: "" },
    { key: "lineTotal", label: "Line total (₦)", type: "money", required: true, hint: "" },
    { key: "paymentMethod", label: "Payment method", type: "text", hint: "Cash, Transfer, POS (card), Credit" },
    { key: "customerName", label: "Customer", type: "text", hint: "" },
    { key: "customerPhone", label: "Customer phone", type: "text", hint: "" },
  ],
  daily_sales: [
    { key: "date", label: "Date", type: "date", required: true, hint: "" },
    { key: "totalSales", label: "Total sales (₦)", type: "money", required: true, hint: "The day's total as written" },
    { key: "cashTotal", label: "Cash (₦)", type: "money", hint: "" },
    { key: "transferTotal", label: "Transfer (₦)", type: "money", hint: "" },
    { key: "posTotal", label: "POS / card (₦)", type: "money", hint: "" },
    { key: "creditTotal", label: "Credit (₦)", type: "money", hint: "" },
    { key: "discount", label: "Discounts (₦)", type: "money", hint: "" },
    { key: "notes", label: "Notes", type: "text", hint: "" },
  ],
  expense: [
    { key: "date", label: "Date", type: "date", required: true, hint: "" },
    { key: "description", label: "Description", type: "text", required: true, hint: "" },
    { key: "amount", label: "Amount (₦)", type: "money", required: true, hint: "" },
    { key: "category", label: "Expense category", type: "text", hint: "e.g. Utilities, Rent, Salaries" },
    { key: "vendor", label: "Paid to / supplier", type: "text", hint: "" },
    { key: "invoiceNumber", label: "Invoice / receipt no.", type: "text", hint: "" },
  ],
  supplier: [
    { key: "name", label: "Supplier name", type: "text", required: true, hint: "" },
    { key: "contactPerson", label: "Contact person", type: "text", hint: "" },
    { key: "phone", label: "Phone", type: "text", hint: "" },
    { key: "email", label: "Email", type: "text", hint: "" },
    { key: "address", label: "Address", type: "text", hint: "" },
    { key: "pcnLicense", label: "PCN licence", type: "text", hint: "e.g. PCN/W/12345" },
    { key: "invoiceNumber", label: "Invoice number", type: "text", hint: "" },
    { key: "invoiceDate", label: "Invoice date", type: "date", hint: "" },
    { key: "outstandingBalance", label: "Outstanding balance (₦)", type: "money", hint: "Only when clearly written as owed" },
  ],
};

export const EXPENSE_CATEGORIES = ["Rent", "Utilities", "Salaries", "Transport", "Maintenance", "Supplies", "Marketing", "Bank charges", "Taxes & levies", "Other"];

/** Category fields: the union of its record kinds' fields (the AI fills those that apply to each record). */
export function categoryFieldKeys(category: ScanCategory) {
  return [...new Set(CATEGORY_KINDS[category].flatMap((kind) => KIND_FIELDS[kind].map((field) => field.key)))];
}

export function fieldDef(kind: RecordKind, key: string) {
  return KIND_FIELDS[kind].find((field) => field.key === key);
}

// ---------------------------------------------------------------- abbreviations

/** Unambiguous pharmacy abbreviations → dosage form. Anything else is left as written. */
const DOSAGE_FORMS: Record<string, string> = {
  tab: "Tablet",
  tabs: "Tablet",
  tablet: "Tablet",
  tablets: "Tablet",
  cap: "Capsule",
  caps: "Capsule",
  capsule: "Capsule",
  capsules: "Capsule",
  susp: "Suspension",
  suspension: "Suspension",
  inj: "Injection",
  injection: "Injection",
  syr: "Syrup",
  syrup: "Syrup",
  oint: "Ointment",
  ointment: "Ointment",
  supp: "Suppository",
  suppository: "Suppository",
  amp: "Ampoule",
  ampoule: "Ampoule",
};

export function expandDosageForm(value: string): { value: string; expanded: boolean } {
  const key = value.trim().toLowerCase().replace(/\.$/, "");
  const full = DOSAGE_FORMS[key];
  if (!full) return { value: value.trim(), expanded: false };
  return { value: full, expanded: full.toLowerCase() !== key };
}

const PAYMENT_METHODS: Record<string, "Cash" | "Transfer" | "Card" | "Credit"> = {
  cash: "Cash",
  csh: "Cash",
  transfer: "Transfer",
  trf: "Transfer",
  trans: "Transfer",
  "bank transfer": "Transfer",
  pos: "Card",
  card: "Card",
  atm: "Card",
  credit: "Credit",
  debt: "Credit",
  owing: "Credit",
};

export function paymentMethodOf(value: string) {
  return PAYMENT_METHODS[value.trim().toLowerCase().replace(/\.$/, "")] ?? null;
}

// ---------------------------------------------------------------- normalising what the AI returned

const CONFIDENCES = new Set(["high", "medium", "low", "none", "confirmed"]);

/**
 * Cleans one record from the provider: only this kind's fields, trimmed strings, a known confidence, blank
 * values marked "none" and unambiguous dosage-form abbreviations expanded (keeping the text as written).
 */
export function normaliseFields(kind: RecordKind, raw: Record<string, unknown>): Fields {
  const fields: Fields = {};
  for (const def of KIND_FIELDS[kind]) {
    const item = raw[def.key] as { value?: unknown; confidence?: unknown; read?: unknown } | undefined;
    let value = typeof item?.value === "string" ? item.value.trim().slice(0, 300) : typeof item?.value === "number" ? String(item.value) : "";
    const read = typeof item?.read === "string" && item.read.trim() ? item.read.trim().slice(0, 300) : undefined;
    let confidence = (item?.confidence === "not_detected" ? "none" : item?.confidence) as Confidence;
    if (!CONFIDENCES.has(confidence)) confidence = value ? "low" : "none";
    if (!value) confidence = "none";
    if (def.key === "dosageForm" && value) {
      const expanded = expandDosageForm(value);
      if (expanded.expanded) {
        fields[def.key] = { value: expanded.value, confidence, read: read ?? value };
        continue;
      }
      value = expanded.value;
    }
    fields[def.key] = read ? { value, confidence, read } : { value, confidence };
  }
  return fields;
}

/** Applies a person's edits: the typed value replaces the reading and counts as confirmed. */
export function applyCorrections(kind: RecordKind, fields: Fields, edits: Record<string, unknown>) {
  const next: Fields = { ...fields };
  let changed = false;
  for (const def of KIND_FIELDS[kind]) {
    if (!(def.key in edits)) continue;
    const edit = edits[def.key];
    const previous = fields[def.key] ?? { value: "", confidence: "none" as Confidence };
    if (edit && typeof edit === "object" && (edit as { confirm?: unknown }).confirm === true) {
      // "This reading is right": keeps the value and marks it checked.
      if (previous.value) next[def.key] = { ...previous, confidence: "confirmed" };
      changed = true;
      continue;
    }
    if (typeof edit !== "string") continue;
    const value = edit.trim().slice(0, 300);
    next[def.key] = { value, confidence: value ? "confirmed" : "none", ...(previous.read ? { read: previous.read } : {}) };
    changed = true;
  }
  return { fields: next, changed };
}

// ---------------------------------------------------------------- validation

export type Issue = { field?: string; level: "error" | "warning"; message: string };

export type Parsed = Record<string, string | number | undefined>;

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Field values converted to numbers / ISO dates, plus every problem found. */
export function checkRecord(kind: RecordKind, fields: Fields, options: { dateFormat?: DateFormat; now?: Date } = {}): { parsed: Parsed; issues: Issue[] } {
  const issues: Issue[] = [];
  const parsed: Parsed = {};
  const format = options.dateFormat ?? "DMY";
  const today = todayIso(options.now);
  for (const def of KIND_FIELDS[kind]) {
    const field = fields[def.key] ?? { value: "", confidence: "none" };
    const value = field.value.trim();
    if (!value) {
      if (def.required) issues.push({ field: def.key, level: "error", message: `${def.label} is missing. Type it from the page, or reject the record.` });
      continue;
    }
    if (field.confidence === "low") issues.push({ field: def.key, level: "error", message: `${def.label} was hard to read ("${field.read ?? value}"). Correct or confirm it.` });
    else if (field.confidence === "medium") issues.push({ field: def.key, level: "warning", message: `${def.label}: check against the page.` });
    if (def.type === "money" || def.type === "integer") {
      const number = parseNumber(value);
      if (number.error || number.value === undefined) {
        issues.push({ field: def.key, level: "error", message: `${def.label} "${value}" is not a number.` });
        continue;
      }
      if (number.value < 0) {
        issues.push({ field: def.key, level: "error", message: `${def.label} cannot be negative.` });
        continue;
      }
      if (def.type === "integer" && !Number.isInteger(number.value)) {
        issues.push({ field: def.key, level: "error", message: `${def.label} must be a whole number.` });
        continue;
      }
      parsed[def.key] = Math.round(number.value * 100) / 100;
    } else if (def.type === "date") {
      const date = parseDate(value, format, def.key === "expiryDate" ? "expiry" : "other");
      if (date.error || !date.value) {
        issues.push({ field: def.key, level: "error", message: `${def.label} "${value}" is not a date we can read. Use day/month/year.` });
        continue;
      }
      parsed[def.key] = date.value;
    } else {
      parsed[def.key] = value;
    }
  }

  // Cross-field checks.
  if (kind === "inventory") {
    if (parsed.quantity !== undefined && Number(parsed.quantity) <= 0) issues.push({ field: "quantity", level: "error", message: "Quantity must be more than zero (leave it blank for catalogue only)." });
    if (parsed.quantity !== undefined && !parsed.expiryDate) issues.push({ field: "expiryDate", level: "warning", message: "No expiry date: needed when this quantity is imported as stock." });
    if (parsed.expiryDate && parsed.manufacturingDate && String(parsed.manufacturingDate) >= String(parsed.expiryDate)) issues.push({ field: "manufacturingDate", level: "error", message: "Manufacturing date is not before the expiry date (are the two dates swapped?)." });
    if (parsed.manufacturingDate && String(parsed.manufacturingDate) > today) issues.push({ field: "manufacturingDate", level: "error", message: "Manufacturing date is in the future." });
    if (parsed.purchasePrice !== undefined && parsed.sellingPrice !== undefined && Number(parsed.sellingPrice) > 0 && Number(parsed.purchasePrice) > Number(parsed.sellingPrice)) {
      issues.push({ field: "sellingPrice", level: "warning", message: "Purchase price is higher than the selling price: are the two prices swapped?" });
    }
  }
  if (kind === "sale" || kind === "daily_sales" || kind === "expense") {
    if (parsed.date && String(parsed.date) > today) issues.push({ field: "date", level: "error", message: "The date is in the future." });
  }
  if (kind === "sale" || kind === "daily_sales") {
    // Historical records only: today's sales belong at the till.
    if (parsed.date && String(parsed.date) === today) issues.push({ field: "date", level: "error", message: "Today's sales must be recorded at the till, not imported as history." });
  }
  if (kind === "sale") {
    if (parsed.quantity !== undefined && Number(parsed.quantity) <= 0) issues.push({ field: "quantity", level: "error", message: "Quantity sold must be more than zero." });
    if (parsed.lineTotal !== undefined && Number(parsed.lineTotal) <= 0) issues.push({ field: "lineTotal", level: "error", message: "Line total must be more than zero." });
    if (parsed.quantity !== undefined && parsed.unitPrice !== undefined && parsed.lineTotal !== undefined) {
      const expected = Number(parsed.quantity) * Number(parsed.unitPrice) - Number(parsed.discount ?? 0);
      if (Math.abs(expected - Number(parsed.lineTotal)) > 0.5) {
        issues.push({ field: "lineTotal", level: "warning", message: `Quantity × unit price${parsed.discount ? " − discount" : ""} is ₦${expected.toLocaleString()}, but the line total reads ₦${Number(parsed.lineTotal).toLocaleString()}. Is a quantity or price misread?` });
      }
    }
    const method = fields.paymentMethod?.value;
    if (method && !paymentMethodOf(method)) issues.push({ field: "paymentMethod", level: "error", message: `Payment method "${method}" is not recognised: use Cash, Transfer, POS or Credit.` });
  }
  if (kind === "daily_sales") {
    if (parsed.totalSales !== undefined && Number(parsed.totalSales) <= 0) issues.push({ field: "totalSales", level: "error", message: "Total sales must be more than zero." });
    const parts = ["cashTotal", "transferTotal", "posTotal", "creditTotal"].map((key) => parsed[key]).filter((value) => value !== undefined).map(Number);
    if (parts.length && parsed.totalSales !== undefined) {
      const sum = parts.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - Number(parsed.totalSales)) > 0.5) issues.push({ field: "totalSales", level: "warning", message: `Payment amounts add up to ₦${sum.toLocaleString()}, not the total ₦${Number(parsed.totalSales).toLocaleString()}.` });
    }
  }
  if (kind === "expense") {
    if (parsed.amount !== undefined && Number(parsed.amount) <= 0) issues.push({ field: "amount", level: "error", message: "Amount must be more than zero." });
    if (parsed.description && String(parsed.description).length < 3) issues.push({ field: "description", level: "error", message: "Describe the expense (at least 3 characters)." });
  }
  if (kind === "supplier") {
    if (parsed.name && String(parsed.name).length < 2) issues.push({ field: "name", level: "error", message: "Supplier name is required." });
    if (parsed.outstandingBalance !== undefined && fields.outstandingBalance?.confidence !== "confirmed") {
      issues.push({ field: "outstandingBalance", level: "error", message: "An outstanding balance becomes money owed in your books: confirm it is clearly written as owed, or clear it." });
    }
  }
  return { parsed, issues };
}

export function hasErrors(issues: Issue[]) {
  return issues.some((issue) => issue.level === "error");
}

// ---------------------------------------------------------------- duplicates

const norm = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();

/** Key that identifies the same paper record (used to find duplicates within a job and against earlier imports). */
export function fingerprint(kind: RecordKind, parsed: Parsed, outletId: string | null) {
  const parts: unknown[] = [kind, outletId ?? ""];
  if (kind === "inventory") parts.push(parsed.name, parsed.strength, parsed.batchNumber, parsed.expiryDate, parsed.quantity);
  else if (kind === "sale") parts.push(parsed.date, parsed.receiptNumber, parsed.productName, parsed.quantity, parsed.lineTotal);
  else if (kind === "daily_sales") parts.push(parsed.date);
  else if (kind === "expense") parts.push(parsed.date, parsed.amount, parsed.description);
  else parts.push(parsed.name);
  return parts.map(norm).join("|");
}

// ---------------------------------------------------------------- AI output contract

/** JSON schema the AI provider must answer with (strict structured output) for one page of a category. */
export function extractionSchema(category: ScanCategory) {
  const field = {
    type: "object",
    properties: {
      value: { type: "string", description: "Normalised value; empty string when not present or unreadable" },
      confidence: { type: "string", enum: ["high", "medium", "low", "not_detected"] },
      read: { type: "string", description: "The characters exactly as written on the page (empty when not present)" },
    },
    required: ["value", "confidence", "read"],
    additionalProperties: false,
  };
  const keys = categoryFieldKeys(category);
  return {
    type: "object",
    properties: {
      page: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["inventory_list", "sales_register", "receipt", "daily_summary", "expense_record", "supplier_record", "other", "unreadable"] },
          readable: { type: "boolean" },
          handwriting: { type: "string", enum: ["none", "some", "mostly"], description: "How much of the page's content is handwritten" },
          notes: { type: "string", description: "Anything a reviewer should know: torn, faded, crossed-out entries, unclear abbreviations" },
          transcription: { type: "string", description: "Plain transcription of the page, line by line" },
        },
        required: ["type", "readable", "handwriting", "notes", "transcription"],
        additionalProperties: false,
      },
      records: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: CATEGORY_KINDS[category] },
            fields: { type: "object", properties: Object.fromEntries(keys.map((key) => [key, field])), required: keys, additionalProperties: false },
            region: {
              type: "object",
              description: "Where the record sits on the page, as fractions of the page width/height (0 to 1)",
              properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
              required: ["x", "y", "width", "height"],
              additionalProperties: false,
            },
          },
          required: ["kind", "fields", "region"],
          additionalProperties: false,
        },
      },
    },
    required: ["page", "records"],
    additionalProperties: false,
  };
}

export type Region = { x: number; y: number; width: number; height: number };

export function cleanRegion(raw: unknown): Region | null {
  const value = raw as Partial<Region> | null;
  if (!value) return null;
  const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : NaN);
  const region = { x: clamp(value.x), y: clamp(value.y), width: clamp(value.width), height: clamp(value.height) };
  if (Object.values(region).some(Number.isNaN) || region.width <= 0 || region.height <= 0) return null;
  region.width = Math.min(region.width, 1 - region.x);
  region.height = Math.min(region.height, 1 - region.y);
  return region.width > 0 && region.height > 0 ? region : null;
}
