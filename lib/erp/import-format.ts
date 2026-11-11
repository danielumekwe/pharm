// Bulk import: column definitions, automatic column mapping and cell parsing (numbers, dates, packaging).
// Pure module (no app imports) so it runs on the client, the server and directly under `node --test`.

export type ImportKind = "catalogue" | "stock" | "both";
export const IMPORT_KINDS: readonly ImportKind[] = ["catalogue", "stock", "both"];
export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  catalogue: "Product catalogue",
  stock: "Opening stock",
  both: "Products + opening stock",
};

export type DateFormat = "DMY" | "MDY";
/** Whether prices in the file are per base unit (e.g. per tablet) or per the unit the quantity is counted in. */
export type PriceBasis = "base" | "unit";

export const FIELD_KEYS = [
  "productId",
  "name",
  "genericName",
  "barcode",
  "sku",
  "category",
  "brand",
  "dosageForm",
  "strength",
  "productType",
  "baseUnit",
  "packaging",
  "packName",
  "packSize",
  "purchasePrice",
  "sellingPrice",
  "reorderLevel",
  "supplier",
  "nafdacNumber",
  "outlet",
  "batchNumber",
  "manufacturingDate",
  "expiryDate",
  "quantity",
  "quantityUnit",
  "supplierRef",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type FieldDef = {
  key: FieldKey;
  label: string;
  /** Which imports use the column. Product columns also identify the product in an opening-stock import. */
  modes: readonly ImportKind[];
  description: string;
  example: string;
  /** Headers (normalised) that map automatically. */
  aliases: readonly string[];
  /** Headers that might mean this field but need the user to confirm. */
  weak?: readonly string[];
};

const ALL: readonly ImportKind[] = ["catalogue", "stock", "both"];
const STOCK: readonly ImportKind[] = ["stock", "both"];

export const FIELDS: readonly FieldDef[] = [
  { key: "productId", label: "PharmaERP ID", modes: ALL, description: "Only for files exported from PharmaERP: the item's internal ID. IDs from other systems are ignored.", example: "", aliases: ["pharmaerpid", "pharmaerpproductid", "erpproductid"] },
  { key: "name", label: "Product Name", modes: ALL, description: "Item name as it should appear at the till, including strength and form where useful.", example: "Paracetamol 500mg Tablets", aliases: ["productname", "itemname", "medicinename", "drugname", "name", "product", "item", "medicine", "drug"], weak: ["description", "itemdescription", "productdescription", "particulars"] },
  { key: "genericName", label: "Generic Name", modes: ALL, description: "Active ingredient (INN). Defaults to the product name.", example: "Paracetamol", aliases: ["genericname", "generic", "activeingredient", "inn"] },
  { key: "barcode", label: "Barcode", modes: ALL, description: "Manufacturer barcode (EAN-13, UPC-A or Code 128) of the base unit. Format the column as text in Excel.", example: "6151100000014", aliases: ["barcode", "ean", "upc", "ean13", "gtin", "upca", "barcodeno", "barcodenumber"] },
  { key: "sku", label: "SKU", modes: ALL, description: "Your product code. Generated when blank.", example: "PCM-500", aliases: ["sku", "productcode", "itemcode", "skucode", "stockcode", "partnumber", "code"] },
  { key: "category", label: "Category", modes: ALL, description: "Must match a category in Products → Categories. Central administrators may add new ones through the import.", example: "Analgesics", aliases: ["category", "productcategory", "itemcategory", "categoryname"], weak: ["group", "department", "class", "productgroup"] },
  { key: "brand", label: "Brand / Manufacturer", modes: ALL, description: "Brand owner or manufacturer.", example: "Emzor", aliases: ["brand", "manufacturer", "brandmanufacturer", "brandname", "maker", "mfr", "manufacturername"], weak: ["company"] },
  { key: "dosageForm", label: "Dosage Form", modes: ALL, description: "Must match a dosage form in Products → Categories.", example: "Tablet", aliases: ["dosageform", "form", "formulation"], weak: ["dosage"] },
  { key: "strength", label: "Strength", modes: ALL, description: "e.g. 500mg, 250mg/5ml. Used to tell similar medicines apart.", example: "500mg", aliases: ["strength"], weak: ["dose"] },
  { key: "productType", label: "Product Type", modes: ALL, description: "Must match a product type in Products → Categories, e.g. Over-the-counter (OTC).", example: "", aliases: ["producttype", "itemtype"], weak: ["type"] },
  { key: "baseUnit", label: "Base Unit", modes: ALL, description: "Smallest unit stock is counted in (Tablet, Capsule, Bottle, Piece).", example: "Tablet", aliases: ["baseunit", "unit", "uom", "unitofmeasure", "unitofmeasurement", "smallestunit"], weak: ["measure"] },
  { key: "packaging", label: "Packaging", modes: ALL, description: "Packaging levels, largest first: \"Carton x10 > Pack x10 > Strip x10 > Tablet\" (1 carton holds 10 packs, 1 pack holds 10 strips, 1 strip holds 10 tablets). Leave blank for single-unit items.", example: "Carton x10 > Pack x10 > Strip x10 > Tablet", aliases: ["packaging", "packaginglevels", "packagingstructure", "unitconversion", "conversion"] },
  { key: "packName", label: "Pack Unit", modes: ALL, description: "Simple alternative to Packaging: the name of the pack (with Pack Size).", example: "", aliases: ["packunit", "packname", "packtype", "packagingunit", "packagename"] },
  { key: "packSize", label: "Pack Size", modes: ALL, description: "Simple alternative to Packaging: base units in one pack.", example: "", aliases: ["packsize", "unitsperpack", "qtyperpack", "quantityperpack", "pcsperpack", "packqty", "perpack"], weak: ["conversionfactor", "factor"] },
  { key: "purchasePrice", label: "Purchase Price", modes: ALL, description: "Cost price. Per base unit unless you choose \"per quantity unit\" in the mapping step.", example: "5", aliases: ["costprice", "purchaseprice", "cost", "unitcost", "buyingprice", "costperunit"], weak: ["lastcost", "averagecost"] },
  { key: "sellingPrice", label: "Selling Price", modes: ALL, description: "Retail price, on the same basis as the purchase price.", example: "8", aliases: ["sellingprice", "retailprice", "saleprice", "salesprice", "mrp"], weak: ["price", "unitprice"] },
  { key: "reorderLevel", label: "Reorder Level", modes: ALL, description: "Minimum stock in base units before a low-stock alert.", example: "200", aliases: ["reorderlevel", "minstock", "minimumstock", "reorderpoint", "minqty", "minimumquantity"], weak: ["reorderqty"] },
  { key: "supplier", label: "Supplier", modes: ALL, description: "Supplier name or code as saved in Contacts → Suppliers.", example: "", aliases: ["supplier", "vendor", "suppliername", "vendorname"] },
  { key: "nafdacNumber", label: "NAFDAC Number", modes: ALL, description: "NAFDAC registration number, e.g. A4-12345.", example: "A4-12345", aliases: ["nafdacnumber", "nafdacno", "nafdac", "nafdacregno"], weak: ["registrationnumber", "regno"] },
  { key: "outlet", label: "Outlet", modes: ALL, description: "Outlet code or name. Blank rows go to the outlet chosen on the import screen.", example: "", aliases: ["outlet", "branch", "store", "location", "outletcode", "branchcode", "storecode", "shop"] },
  { key: "batchNumber", label: "Batch Number", modes: STOCK, description: "Batch / lot number printed on the pack. Each batch is a separate row.", example: "PCM2401", aliases: ["batchno", "batchnumber", "batch", "lotnumber", "lotno", "lot", "batchlot"] },
  { key: "manufacturingDate", label: "Manufacturing Date", modes: STOCK, description: "Optional. Day/month/year (choose the order on the import screen) or YYYY-MM-DD.", example: "2026-01-15", aliases: ["manufacturingdate", "mfgdate", "mfg", "mfd", "manufacturedate", "dateofmanufacture", "productiondate", "mfddate"] },
  { key: "expiryDate", label: "Expiry Date", modes: STOCK, description: "Required for stock. A month/year (e.g. 12/2028) means the last day of that month.", example: "2028-12-31", aliases: ["expiry", "expirydate", "expirationdate", "expdate", "exp", "expires", "bestbefore", "useby"] },
  { key: "quantity", label: "Quantity", modes: STOCK, description: "Quantity in stock for this batch, in the Quantity Unit (base units when blank).", example: "2", aliases: ["stock", "quantity", "qty", "availablequantity", "stockquantity", "qtyonhand", "quantityonhand", "onhand", "closingstock", "stocklevel", "currentstock", "availableqty", "instock"], weak: ["balance"] },
  { key: "quantityUnit", label: "Quantity Unit", modes: STOCK, description: "Packaging level the quantity is counted in (e.g. Carton). Converted to base units with the product's own packaging.", example: "Carton", aliases: ["quantityunit", "stockunit", "qtyunit", "unitofquantity", "countedin"] },
  { key: "supplierRef", label: "Supplier Reference", modes: STOCK, description: "Optional supplier invoice or batch reference.", example: "", aliases: ["supplierreference", "supplierref", "invoicenumber", "invoiceno", "grnnumber", "supplierbatchref"], weak: ["reference"] },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((field) => [field.key, field])) as Record<FieldKey, FieldDef>;

export function fieldsFor(kind: ImportKind) {
  return FIELDS.filter((field) => field.modes.includes(kind));
}

/** Columns that must be mapped before a preview can be built. */
export function requiredFields(kind: ImportKind): FieldKey[] {
  if (kind === "catalogue") return ["name"];
  if (kind === "stock") return ["batchNumber", "expiryDate", "quantity"];
  return ["name"];
}

export type Mapping = Partial<Record<FieldKey, number>>;

export function mappingProblems(kind: ImportKind, mapping: Mapping, columnCount: number): string[] {
  const problems: string[] = [];
  const used = new Map<number, FieldKey>();
  for (const [key, index] of Object.entries(mapping) as [FieldKey, number][]) {
    if (index === undefined || index === null) continue;
    if (!FIELD_BY_KEY[key]) problems.push(`Unknown field ${key}.`);
    else if (!Number.isInteger(index) || index < 0 || index >= columnCount) problems.push(`${FIELD_BY_KEY[key].label}: choose a column from the file.`);
    else if (used.has(index)) problems.push(`One column is mapped to both ${FIELD_BY_KEY[used.get(index)!].label} and ${FIELD_BY_KEY[key].label}.`);
    else used.set(index, key);
  }
  for (const key of requiredFields(kind)) if (mapping[key] === undefined) problems.push(`Map a column to ${FIELD_BY_KEY[key].label}.`);
  if (kind === "stock" && ["name", "barcode", "sku", "productId"].every((key) => mapping[key as FieldKey] === undefined)) {
    problems.push("Map a column that identifies the product: Product Name, Barcode or SKU.");
  }
  return problems;
}

// ---------------------------------------------------------------- automatic mapping

export function normaliseHeader(header: string) {
  return header.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

export type Suggestion = { index: number; reason: string };
export type AutoMapping = {
  /** Confident matches only. */
  mapping: Mapping;
  /** Possible columns for fields that were not mapped automatically; the user must pick. */
  suggestions: Partial<Record<FieldKey, Suggestion[]>>;
};

/**
 * Maps a header to a field only when it is a known name for exactly that field and no other column claims the
 * same field. Everything else (similar names, generic names like "Price", two columns for one field) becomes a
 * suggestion the user has to confirm.
 */
export function autoMap(headers: readonly string[], kind: ImportKind): AutoMapping {
  const fields = fieldsFor(kind);
  const strong = new Map<FieldKey, number[]>();
  const suggestions: Partial<Record<FieldKey, Suggestion[]>> = {};
  const suggest = (key: FieldKey, index: number, reason: string) => {
    const list = (suggestions[key] ??= []);
    if (!list.some((entry) => entry.index === index)) list.push({ index, reason });
  };
  headers.forEach((header, index) => {
    const name = normaliseHeader(header);
    if (!name) return;
    const exact = fields.filter((field) => field.aliases.includes(name));
    if (exact.length === 1) {
      strong.set(exact[0].key, [...(strong.get(exact[0].key) ?? []), index]);
      return;
    }
    for (const field of exact) suggest(field.key, index, `"${header}" could mean several fields`);
    for (const field of fields) {
      if (field.weak?.includes(name)) suggest(field.key, index, `"${header}" might be ${field.label}`);
      else if (!exact.length && field.aliases.some((alias) => alias.length >= 4 && (name.startsWith(alias) || name.endsWith(alias)))) {
        suggest(field.key, index, `"${header}" looks like ${field.label}`);
      }
    }
  });
  const mapping: Mapping = {};
  for (const [key, indexes] of strong) {
    if (indexes.length === 1) mapping[key] = indexes[0];
    else for (const index of indexes) suggest(key, index, `${indexes.length} columns could be ${FIELD_BY_KEY[key].label}`);
  }
  // A column already mapped confidently is not suggested for anything else.
  const taken = new Set(Object.values(mapping));
  for (const key of Object.keys(suggestions) as FieldKey[]) {
    if (mapping[key] !== undefined) delete suggestions[key];
    else suggestions[key] = suggestions[key]!.filter((entry) => !taken.has(entry.index));
    if (!suggestions[key]?.length) delete suggestions[key];
  }
  return { mapping, suggestions };
}

// ---------------------------------------------------------------- cell parsing

export type Parsed<T> = { value?: T; error?: string };

/** Numbers as old systems export them: "₦1,250.00", "NGN 1250", "1 250", "(12)" for negatives. */
export function parseNumber(raw: string | undefined): Parsed<number> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  let cleaned = text.replace(/^(₦|ngn|n|\$|usd)\s*/i, "").replace(/[\s,]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { error: `"${text}" is not a number` };
  const value = Number(cleaned) * (negative ? -1 : 1);
  return Number.isFinite(value) ? { value } : { error: `"${text}" is not a number` };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(year: number, month: number, day: number): Parsed<string> {
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1950 || year > 2100 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { error: "is not a real date" };
  return { value: date.toISOString().slice(0, 10) };
}

function lastDay(year: number, month: number) {
  if (year < 100) year += 2000;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Accepts YYYY-MM-DD, day/month/year or month/day/year (by `format`), 31-Mar-2027, Mar 2027, 12/2027 and
 * Excel serial day numbers. A month without a day means the last day of the month for expiry dates and the
 * first day otherwise.
 */
export function parseDate(raw: string | undefined, format: DateFormat, role: "expiry" | "other" = "other"): Parsed<string> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  const fail = (why = "is not a date we can read") => ({ error: `"${text}" ${why}` });
  const finish = (result: Parsed<string>) => (result.error ? fail(result.error) : result);
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (match) return finish(iso(Number(match[1]), Number(match[2]), Number(match[3])));
  match = text.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (match) return finish(iso(Number(match[1]), Number(match[2]), role === "expiry" ? lastDay(Number(match[1]), Number(match[2])) : 1));
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (match) {
    const [first, second, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const [day, month] = format === "DMY" ? [first, second] : [second, first];
    return finish(iso(year, month, day));
  }
  match = text.match(/^(\d{1,2})[-/.](\d{4}|\d{2})$/);
  if (match) {
    const [month, year] = [Number(match[1]), Number(match[2])];
    if (month < 1 || month > 12) return fail();
    return finish(iso(year, month, role === "expiry" ? lastDay(year, month) : 1));
  }
  match = text.match(/^(?:(\d{1,2})[-/ .])?([a-z]{3,9})[-/ .,]+(\d{2}|\d{4})$/i);
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    if (!month) return fail();
    const year = Number(match[3]);
    const day = match[1] ? Number(match[1]) : role === "expiry" ? lastDay(year, month) : 1;
    return finish(iso(year, month, day));
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    // Excel serial date (days since 1899-12-30).
    const serial = Math.floor(Number(text));
    if (serial > 20000 && serial < 80000) return { value: new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10) };
  }
  return fail();
}

/** Unit names compared loosely: "Tabs", "tablets" and "Tablet" are the same unit. */
const UNIT_SYNONYMS: Record<string, string> = {
  tab: "tablet", tabs: "tablet", caps: "capsule", cap: "capsule", pcs: "piece", pc: "piece", pce: "piece", btl: "bottle", btls: "bottle",
  ctn: "carton", ctns: "carton", pkt: "packet", pkts: "packet", amp: "ampoule", amps: "ampoule", pk: "pack", pks: "pack", bx: "box", sachets: "sachet",
};

export function unitKey(name: string) {
  let key = name.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (UNIT_SYNONYMS[key]) return UNIT_SYNONYMS[key];
  if (key.endsWith("es") && key.length > 4 && !key.endsWith("ses")) key = key.slice(0, -2);
  else if (key.endsWith("s") && key.length > 3) key = key.slice(0, -1);
  return UNIT_SYNONYMS[key] ?? key;
}

export type LevelSpec = { name: string; contains: number };

/**
 * Packaging text, largest level first. Two styles:
 *   "Carton x10 > Pack x10 > Strip x10 > Tablet"  (each level holds N of the next)
 *   "1 Carton = 10 Pack = 100 Strip = 1000 Tablet" (as PharmaERP prints conversions)
 */
export function parsePackaging(raw: string | undefined): Parsed<LevelSpec[]> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  const fail = (why: string) => ({ error: `Packaging "${text}": ${why}` });
  if (text.includes("=")) {
    const parts = text.split("=").map((part) => part.trim().match(/^([\d,.]+)\s*(.+)$/));
    if (parts.some((part) => !part)) return fail("write it as 1 Carton = 10 Pack = 100 Tablet");
    const counts = parts.map((part) => Number(part![1].replace(/,/g, "")));
    if (counts[0] !== 1) return fail("start with 1 of the largest package");
    const levels: LevelSpec[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const next = counts[index + 1];
      const contains = next === undefined ? 1 : next / counts[index];
      if (!Number.isInteger(contains) || contains < (next === undefined ? 1 : 2)) return fail("each level must hold a whole number (2 or more) of the next");
      levels.push({ name: parts[index]![2].trim(), contains });
    }
    return { value: levels };
  }
  const segments = text.split(/\s*[>›]\s*/).filter(Boolean);
  const levels: LevelSpec[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const isLast = index === segments.length - 1;
    const match = segments[index].match(/^(.+?)\s*(?:[x×*]\s*(\d+)|\((\d+)\))?$/i);
    if (!match) return fail(`cannot read "${segments[index]}"`);
    const contains = match[2] ?? match[3];
    if (!isLast && !contains) return fail(`say how many of the next level one ${match[1].trim()} holds, e.g. "${match[1].trim()} x10"`);
    if (isLast && contains && Number(contains) !== 1) return fail(`the last level (${match[1].trim()}) is the base unit and holds nothing smaller`);
    levels.push({ name: match[1].trim(), contains: isLast ? 1 : Number(contains) });
  }
  return { value: levels };
}

/** "1 Carton = 10 Pack = 100 Tablet" for display, from levels largest first. */
export function describeLevels(levels: readonly LevelSpec[]) {
  if (levels.length < 2) return levels[0] ? `${levels[0].name} (single unit)` : "";
  // units[i] = base units in one package of level i.
  const units: number[] = [];
  for (let index = levels.length - 1; index >= 0; index -= 1) units[index] = index === levels.length - 1 ? 1 : units[index + 1] * levels[index].contains;
  return levels.map((level, index) => `${index === 0 ? 1 : (units[0] / units[index]).toLocaleString("en-NG")} ${level.name}`).join(" = ");
}

// ---------------------------------------------------------------- product names

/** Lowercase, unit spacing removed ("500 mg" → "500mg"), punctuation dropped. */
export function normaliseName(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/(\d)\s+(mg|mcg|µg|g|kg|ml|l|iu|%)\b/g, "$1$2")
    .replace(/[^a-z0-9%./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STRENGTH = /(\d+(?:\.\d+)?)\s*(mcg|µg|mg|g|kg|ml|l|iu|%)(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*(ml|l|g|mg))?/gi;

/** Strength tokens in a name or strength cell, e.g. "Amoxil 250mg/5ml" → ["250mg/5ml"]. */
export function strengthTokens(text: string) {
  const tokens: string[] = [];
  for (const match of text.toLowerCase().matchAll(STRENGTH)) tokens.push(`${Number(match[1])}${match[2].replace("µg", "mcg")}${match[4] ? `/${match[3] ? Number(match[3]) : ""}${match[4]}` : ""}`);
  return tokens;
}

/** True when both sides state a strength and the strengths differ (different medicines). */
export function strengthsConflict(a: string, b: string) {
  // Sets: a name that repeats its strength column ("Amoxil 250mg" + "250mg") states one strength.
  const left = [...new Set(strengthTokens(a))].sort();
  const right = [...new Set(strengthTokens(b))].sort();
  return left.length > 0 && right.length > 0 && left.join("+") !== right.join("+");
}

const NAME_NOISE = new Set(["tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules", "syrup", "susp", "suspension", "inj", "injection", "the", "and", "of", "x"]);

export function nameTokens(name: string) {
  return normaliseName(name)
    .split(" ")
    .filter((token) => token && !NAME_NOISE.has(token) && strengthTokens(token).length === 0);
}

/** Token overlap (Jaccard) of two names, ignoring strengths and dosage-form words. */
export function nameSimilarity(a: string, b: string) {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// ---------------------------------------------------------------- CSV output

/**
 * One CSV cell. Values that a spreadsheet would run as a formula (=, +, -, @, tab, CR) are prefixed with an
 * apostrophe; plain negative numbers are left alone.
 */
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly unknown[])[]) {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------- templates

function ean13(body12: string) {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(body12[11 - index]) * (index % 2 === 0 ? 3 : 1);
  return `${body12}${(10 - (sum % 10)) % 10}`;
}

const TEMPLATE_KEYS: Record<ImportKind, FieldKey[]> = {
  catalogue: ["name", "genericName", "barcode", "sku", "category", "brand", "dosageForm", "strength", "baseUnit", "packaging", "purchasePrice", "sellingPrice", "reorderLevel", "supplier", "nafdacNumber", "outlet"],
  stock: ["name", "barcode", "sku", "outlet", "batchNumber", "manufacturingDate", "expiryDate", "quantity", "quantityUnit", "purchasePrice", "supplier", "supplierRef"],
  both: ["name", "genericName", "barcode", "sku", "category", "brand", "dosageForm", "strength", "baseUnit", "packaging", "purchasePrice", "sellingPrice", "reorderLevel", "supplier", "nafdacNumber", "outlet", "batchNumber", "manufacturingDate", "expiryDate", "quantity", "quantityUnit", "supplierRef"],
};

type SampleRow = Partial<Record<FieldKey, string>>;

const SAMPLES: SampleRow[] = [
  { name: "Paracetamol 500mg Tablets", genericName: "Paracetamol", barcode: ean13("615110000001"), sku: "PCM-500", category: "Analgesics", brand: "Emzor", dosageForm: "Tablet", strength: "500mg", baseUnit: "Tablet", packaging: "Carton x10 > Pack x10 > Strip x10 > Tablet", purchasePrice: "5", sellingPrice: "8", reorderLevel: "500", nafdacNumber: "A4-10001", batchNumber: "PCM2401", manufacturingDate: "2026-01-15", expiryDate: "2028-12-31", quantity: "2", quantityUnit: "Carton" },
  { name: "Paracetamol 500mg Tablets", genericName: "Paracetamol", barcode: ean13("615110000001"), sku: "PCM-500", category: "Analgesics", brand: "Emzor", dosageForm: "Tablet", strength: "500mg", baseUnit: "Tablet", packaging: "Carton x10 > Pack x10 > Strip x10 > Tablet", purchasePrice: "5.5", sellingPrice: "8", reorderLevel: "500", nafdacNumber: "A4-10001", batchNumber: "PCM2405", manufacturingDate: "2026-05-02", expiryDate: "2029-04-30", quantity: "15", quantityUnit: "Pack" },
  { name: "Amoxicillin 500mg Capsules", genericName: "Amoxicillin", barcode: ean13("615110000002"), sku: "AMX-500", category: "Antibiotics", brand: "Fidson", dosageForm: "Capsule", strength: "500mg", baseUnit: "Capsule", packaging: "Pack x10 > Strip x10 > Capsule", purchasePrice: "18", sellingPrice: "30", reorderLevel: "200", nafdacNumber: "A4-10002", batchNumber: "AMX7781", manufacturingDate: "2026-03-10", expiryDate: "2028-02-29", quantity: "300", quantityUnit: "Capsule" },
  { name: "Benylin Cough Syrup 100ml", genericName: "Diphenhydramine", barcode: ean13("615110000003"), sku: "BNL-100", category: "Cough & cold", brand: "Johnson & Johnson", dosageForm: "Syrup", strength: "", baseUnit: "Bottle", packaging: "Carton x24 > Bottle", purchasePrice: "1200", sellingPrice: "1800", reorderLevel: "24", nafdacNumber: "A4-10003", batchNumber: "BN2309", manufacturingDate: "2026-02-01", expiryDate: "06/2028", quantity: "1", quantityUnit: "Carton" },
];

export function templateColumns(kind: ImportKind) {
  return TEMPLATE_KEYS[kind].map((key) => FIELD_BY_KEY[key]);
}

export function templateRows(kind: ImportKind) {
  const keys = TEMPLATE_KEYS[kind];
  const rows = kind === "catalogue" ? SAMPLES.filter((row, index) => index !== 1) : SAMPLES;
  return rows.map((row) => keys.map((key) => row[key] ?? ""));
}

export function columnGuide(kind: ImportKind) {
  const required = new Set<FieldKey>(kind === "stock" ? ["batchNumber", "expiryDate", "quantity"] : ["name"]);
  return templateColumns(kind).map((field) => ({
    column: field.label,
    required: required.has(field.key) ? "Yes" : field.key === "name" && kind === "stock" ? "Name, Barcode or SKU" : field.key === "purchasePrice" || field.key === "sellingPrice" ? (kind === "stock" ? "No" : "For new products") : "No",
    description: field.description,
    example: field.example,
  }));
}
