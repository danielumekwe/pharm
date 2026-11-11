// Bulk product and opening-stock import (Inventory → Bulk Import / Data Migration).
//
// Flow: upload (file parsed and staged in inventory_imports) → map columns → preview (nothing is written to
// products, batches or stock) → confirmed commit → report → optional rollback.
//
// Rules that keep stock correct:
// - Products are created with registerProduct() and stock enters only as OPENING rows of the stock ledger
//   (registerProduct / receiveIntoNewBatch → postStock). No balance field is written directly.
// - One batch per row; batches are never merged. Quantities are converted with each product's own packaging.
// - The commit runs in chunks of whole products. Each chunk is one database transaction together with the
//   import record's progress, so a chunk either fully lands or leaves nothing behind. A stopped import can be
//   resumed or rolled back.
// - Every query on inventory_imports is limited to the signed-in pharmacy (and Row Level Security).

import { randomUUID } from "node:crypto";

import { batches, outlets, products, stockMovements, type BatchRecord, type Product } from "@/lib/data";
import { runSql } from "@/lib/db/database";
import { newId } from "@/lib/erp/ids";
import { fileHash, readImportFile } from "@/lib/erp/import-file";
import {
  autoMap,
  describeLevels,
  FIELD_KEYS,
  fieldsFor,
  IMPORT_KIND_LABELS,
  IMPORT_KINDS,
  mappingProblems,
  nameSimilarity,
  nameTokens,
  normaliseName,
  parseDate,
  parseNumber,
  parsePackaging,
  strengthsConflict,
  toCsv,
  unitKey,
  type DateFormat,
  type FieldKey,
  type ImportKind,
  type LevelSpec,
  type Mapping,
  type PriceBasis,
} from "@/lib/erp/import-format";
import { baseUnitName, postStock, receiveIntoNewBatch } from "@/lib/erp/ledger";
import { barcodeError, buildPackaging, detectBarcodeFormat, normaliseBarcode, PackagingError, type PackagingLevel } from "@/lib/erp/packaging";
import { barcodeOwner, catalogLists, normaliseNafdac, registerProduct, resolvePricing, type OpeningBatchInput, type RegistrationInput } from "@/lib/erp/products";
import { assertCan, assertOutletAccess, DomainError, productPackaging, recordAudit } from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";
import { currentTenantId } from "@/lib/saas/tenant";

/** Rows per commit chunk (a product's rows are never split across chunks). */
function chunkRows() {
  const configured = Number(process.env.INVENTORY_IMPORT_CHUNK_ROWS);
  return Number.isInteger(configured) && configured > 0 ? configured : 400;
}

export type ImportStatus = "DRAFT" | "PREVIEWED" | "IN_PROGRESS" | "COMPLETED" | "ROLLED_BACK" | "CANCELLED";
export type ImportOptions = { outletId: string; dateFormat: DateFormat; priceBasis: PriceBasis };
export type Decision = { action: "match"; productId: string } | { action: "create" } | { action: "skip" };
type Values = Partial<Record<FieldKey, string>>;

export type RowStatus = "ready" | "warning" | "review" | "error" | "skipped";
export type ProductCard = {
  id?: string;
  name: string;
  genericName?: string;
  strength?: string;
  dosageForm?: string;
  category?: string;
  barcode?: string;
  sku?: string;
  baseUnit?: string;
  packaging?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  stock?: number;
  outlet?: string;
};
export type PreviewBatch = {
  batchNumber: string;
  expiryDate: string;
  manufacturingDate?: string;
  quantity: number;
  unit: string;
  baseQuantity: number;
  baseUnit: string;
  /** Cost per base unit. */
  unitCost: number;
  conversion: string;
};
type Flag = "missing" | "conversion" | "expired" | "nearExpiry" | "duplicate" | "invalid";
export type PreviewRow = {
  index: number;
  row: number;
  values: Values;
  edited: boolean;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  notes: string[];
  flags: Flag[];
  outletId?: string;
  outletName?: string;
  action: "create" | "match" | "review" | "none";
  productName: string;
  productId?: string;
  matchedBy?: string;
  incoming: ProductCard;
  existing?: ProductCard;
  candidates?: ProductCard[];
  batch?: PreviewBatch;
  group?: string;
  decision?: Decision;
};
export type PreviewSummary = {
  totalRows: number;
  readyRows: number;
  warningRows: number;
  reviewRows: number;
  errorRows: number;
  skippedRows: number;
  newProducts: number;
  matchedProducts: number;
  newBatches: number;
  openingQuantity: number;
  duplicateWarnings: number;
  invalidRows: number;
  missingRequired: number;
  conversionIssues: number;
  expiredRows: number;
  nearExpiryRows: number;
  newCategories: string[];
  chunks: number;
};

type Created = {
  products: string[];
  /** Batches created for products the import created. */
  batches: string[];
  /** Batches added to products that already existed. */
  stockBatches: string[];
  ledger: string[];
  prices: string[];
  registrations: string[];
  catalog: { categories: string[]; dosageForms: string[]; productTypes: string[] };
};
const emptyCreated = (): Created => ({ products: [], batches: [], stockBatches: [], ledger: [], prices: [], registrations: [], catalog: { categories: [], dosageForms: [], productTypes: [] } });

export type RowResult = {
  row: number;
  status: "imported" | "matched" | "rejected" | "skipped";
  action?: "create" | "match";
  productId?: string;
  productName: string;
  outletName?: string;
  batchId?: string;
  batchNumber?: string;
  expiryDate?: string;
  quantity?: number;
  unit?: string;
  baseQuantity?: number;
  baseUnit?: string;
  messages: string[];
};

type Plan = {
  /** Importable rows: action and (for matches) the product confirmed at preview. */
  rows: Record<string, { a: "create" | "match"; p?: string }>;
  chunks: number[][];
  reviewRows: number;
};

type ImportRecord = {
  id: string;
  reference: string;
  kind: ImportKind;
  status: ImportStatus;
  fileName: string;
  fileHash: string;
  fileSize: number;
  rowCount: number;
  outletId: string | null;
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
  mapping: Mapping;
  options: ImportOptions | null;
  edits: Record<string, Values>;
  decisions: Record<string, Decision>;
  plan: Plan | null;
  planToken: string | null;
  nextChunk: number;
  chunkCount: number;
  results: Record<string, RowResult>;
  created: Created;
  summary: Record<string, unknown>;
  createdById: string;
  createdByName: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rollbackReason: string | null;
};

// ---------------------------------------------------------------- persistence (inventory_imports)

type DbRow = Record<string, unknown>;
const JSON_COLUMNS = new Set(["data", "mapping", "options", "edits", "decisions", "plan", "results", "created", "summary"]);
const NOW = Symbol("now");
const isoOrNull = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null);

function fromDb(row: DbRow): ImportRecord {
  const data = (row.data ?? {}) as { headers?: string[]; rows?: string[][]; rowNumbers?: number[] };
  return {
    id: String(row.id),
    reference: String(row.reference),
    kind: row.kind as ImportKind,
    status: row.status as ImportStatus,
    fileName: String(row.file_name),
    fileHash: String(row.file_hash),
    fileSize: Number(row.file_size),
    rowCount: Number(row.row_count),
    outletId: (row.outlet_id as string | null) ?? null,
    headers: data.headers ?? [],
    rows: data.rows ?? [],
    rowNumbers: data.rowNumbers ?? [],
    mapping: (row.mapping ?? {}) as Mapping,
    options: (row.options ?? null) as ImportOptions | null,
    edits: (row.edits ?? {}) as Record<string, Values>,
    decisions: (row.decisions ?? {}) as Record<string, Decision>,
    plan: (row.plan ?? null) as Plan | null,
    planToken: (row.plan_token as string | null) ?? null,
    nextChunk: Number(row.next_chunk ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    results: (row.results ?? {}) as Record<string, RowResult>,
    created: { ...emptyCreated(), ...((row.created ?? {}) as Partial<Created>) },
    summary: (row.summary ?? {}) as Record<string, unknown>,
    createdById: String(row.created_by_id),
    createdByName: String(row.created_by_name),
    createdAt: isoOrNull(row.created_at) ?? "",
    startedAt: isoOrNull(row.started_at),
    completedAt: isoOrNull(row.completed_at),
    rolledBackAt: isoOrNull(row.rolled_back_at),
    rolledBackBy: (row.rolled_back_by as string | null) ?? null,
    rollbackReason: (row.rollback_reason as string | null) ?? null,
  };
}

function visibleTo(actor: Actor, record: Pick<ImportRecord, "outletId" | "createdById">) {
  if (!isOutletScoped(actor.role)) return true;
  return record.createdById === actor.id || (record.outletId !== null && actor.outletIds.includes(record.outletId));
}

async function loadImport(actor: Actor, id: string, lock = false) {
  const [row] = await runSql<DbRow>(`SELECT * FROM inventory_imports WHERE id = $1 AND tenant_id = $2${lock ? " FOR UPDATE" : ""}`, [id, currentTenantId()]);
  const record = row ? fromDb(row) : null;
  if (!record || !visibleTo(actor, record)) throw new DomainError("Import not found.", 404);
  return record;
}

async function saveImport(id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  const params: unknown[] = [id, currentTenantId()];
  const sets = keys.map((key) => {
    const value = patch[key];
    if (value === NOW) return `${key} = now()`;
    params.push(JSON_COLUMNS.has(key) ? JSON.stringify(value) : value);
    return `${key} = $${params.length}${JSON_COLUMNS.has(key) ? "::jsonb" : ""}`;
  });
  await runSql(`UPDATE inventory_imports SET ${[...sets, "updated_at = now()"].join(", ")} WHERE id = $1 AND tenant_id = $2`, params);
}

function assertImporter(actor: Actor) {
  assertCan(actor, "inventory.import");
  if (actor.support) throw new DomainError("Support sessions are read-only.", 403);
}

// ---------------------------------------------------------------- analysis (shared by preview and commit)

type ProductPlan = {
  input: Omit<RegistrationInput, "openingStock">;
  levels: PackagingLevel[];
  addCatalog: { categories: string[]; dosageForms: string[]; productTypes: string[] };
};

type Analysis = {
  rows: PreviewRow[];
  /** Group key → row indexes, in file order. */
  groups: Map<string, number[]>;
  newProducts: Map<string, ProductPlan>;
  summary: PreviewSummary;
};

const money = (value: number) => `₦${value.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

function card(product: Product): ProductCard {
  const levels = productPackaging(product);
  return {
    id: product.id,
    name: product.name,
    genericName: product.genericName,
    strength: product.strength && product.strength !== "-" ? product.strength : undefined,
    dosageForm: product.dosageForm,
    category: product.category,
    barcode: product.barcode || undefined,
    sku: product.sku,
    baseUnit: baseUnitName(product),
    packaging: describeLevels(levels.map((level) => ({ name: level.name, contains: level.contains }))),
    purchasePrice: product.purchasePrice,
    sellingPrice: product.sellingPrice,
    stock: product.stock,
    outlet: outlets.find((outlet) => outlet.id === product.outletId)?.name,
  };
}

function rowValues(record: ImportRecord, index: number) {
  const values: Values = {};
  for (const [key, column] of Object.entries(record.mapping) as [FieldKey, number][]) {
    if (column !== undefined && column !== null) values[key] = (record.rows[index]?.[column] ?? "").trim();
  }
  const edits = record.edits[String(index)];
  if (edits) for (const [key, value] of Object.entries(edits) as [FieldKey, string][]) values[key] = (value ?? "").trim();
  return { values, edited: Boolean(edits && Object.keys(edits).length) };
}

/** Packaging levels written in the row (Packaging column, or Pack Unit + Pack Size, or just a base unit). */
function fileLevels(values: Values): { levels?: LevelSpec[]; explicit: boolean; error?: string } {
  const spec = parsePackaging(values.packaging);
  if (spec.error) return { explicit: true, error: spec.error };
  const base = values.baseUnit?.trim();
  const size = parseNumber(values.packSize);
  if (size.error) return { explicit: true, error: `Pack size ${size.error}.` };
  if (spec.value) {
    const last = spec.value[spec.value.length - 1];
    if (base && unitKey(base) !== unitKey(last.name)) return { explicit: true, error: `Base unit "${base}" does not match the last packaging level "${last.name}".` };
    if (size.value !== undefined && size.value !== 1 && spec.value.length >= 2) {
      const pack = spec.value[spec.value.length - 2];
      if (pack.contains !== size.value || (values.packName && unitKey(values.packName) !== unitKey(pack.name))) {
        return { explicit: true, error: `Pack size ${values.packSize} ${values.packName ?? ""} disagrees with the packaging "${values.packaging}".` };
      }
    }
    return { levels: spec.value, explicit: true };
  }
  if (size.value !== undefined && size.value !== 1) {
    if (!Number.isInteger(size.value) || size.value < 2) return { explicit: true, error: `Pack size must be a whole number of 2 or more (found "${values.packSize}").` };
    return { levels: [{ name: values.packName?.trim() || "Pack", contains: size.value }, { name: base || "Unit", contains: 1 }], explicit: true };
  }
  return { levels: [{ name: base || "Unit", contains: 1 }], explicit: false };
}

/** Base units in each level, largest first. */
function unitsOf(levels: LevelSpec[]) {
  const units: number[] = [];
  for (let index = levels.length - 1; index >= 0; index -= 1) units[index] = index === levels.length - 1 ? 1 : units[index + 1] * levels[index].contains;
  return units;
}

function pickFromList(list: string[], value: string | undefined, allowAdd: boolean, what: string): { value?: string; add?: string; error?: string } {
  const text = value?.trim();
  if (!text) return {};
  if (text.length > 60) return { error: `${what} "${text.slice(0, 30)}…" is longer than 60 characters.` };
  const existing = list.find((entry) => entry.toLowerCase() === text.toLowerCase());
  if (existing) return { value: existing };
  if (allowAdd) return { value: text, add: text };
  return { error: `${what} "${text}" is not in your catalogue. Add it under Products → Categories first (needs a central administrator).` };
}

function findSupplier(text: string | undefined) {
  const name = text?.trim().toLowerCase();
  if (!name) return undefined;
  return getStore().suppliers.find((supplier) => supplier.name.toLowerCase() === name || supplier.code?.toLowerCase() === name);
}

function analyse(record: ImportRecord, actor: Actor, exclude: Set<string> = new Set()): Analysis {
  const kind = record.kind;
  const options = record.options;
  if (!options) throw new DomainError("Choose the destination outlet and options first.");
  const store = getStore();
  const today = new Date().toISOString().slice(0, 10);
  const nearDays = store.settings.nearExpiryDays;
  const catalog = catalogLists();
  const canCatalog = can(actor, "catalog.manage");
  const withStock = kind !== "catalogue";

  // Indexes over this pharmacy's products (products this import created are left out: they are its own work).
  const pool = products.filter((product) => !exclude.has(product.id));
  const byBarcode = new Map<string, Product[]>();
  const bySku = new Map<string, Product[]>();
  const byName = new Map<string, Product[]>();
  const byToken = new Map<string, Product[]>();
  const add = (map: Map<string, Product[]>, key: string, product: Product) => {
    const list = map.get(key);
    if (list) {
      if (!list.includes(product)) list.push(product);
    } else map.set(key, [product]);
  };
  for (const product of pool) {
    for (const code of [product.barcode, ...(product.barcodes ?? []).map((row) => row.code)]) if (code) add(byBarcode, `${product.outletId}|${code}`, product);
    if (product.sku) add(bySku, `${product.outletId}|${product.sku.toUpperCase()}`, product);
    add(byName, `${product.outletId}|${normaliseName(product.name)}`, product);
    for (const token of nameTokens(product.name)) add(byToken, `${product.outletId}|${token}`, product);
  }

  const rows: PreviewRow[] = record.rows.map((_, index) => {
    const { values, edited } = rowValues(record, index);
    const name = (values.name ?? "").replace(/\s+/g, " ").trim();
    return {
      index,
      row: record.rowNumbers[index] ?? index + 2,
      values,
      edited,
      status: "ready",
      errors: [],
      warnings: [],
      notes: [],
      flags: [],
      action: "none",
      productName: name,
      incoming: { name, strength: values.strength || undefined, dosageForm: values.dosageForm || undefined, barcode: values.barcode || undefined, sku: values.sku?.toUpperCase() || undefined, category: values.category || undefined, baseUnit: values.baseUnit || undefined, packaging: values.packaging || undefined },
      decision: record.decisions[String(index)],
    };
  });
  const flag = (row: PreviewRow, value: Flag) => {
    if (!row.flags.includes(value)) row.flags.push(value);
  };
  const fail = (row: PreviewRow, message: string, kindOf?: Flag) => {
    if (!row.errors.includes(message)) row.errors.push(message);
    if (kindOf) flag(row, kindOf);
  };

  // 1. Outlet, identity and matching, row by row.
  const reviewKey = (row: PreviewRow) => `${row.outletId}|${normaliseName(row.productName)}`;
  for (const row of rows) {
    const values = row.values;
    if (row.decision?.action === "skip") {
      row.status = "skipped";
      row.notes.push("Skipped by you.");
      continue;
    }
    // Outlet: the row's own outlet column, or the outlet chosen for the import.
    const outletText = values.outlet?.trim();
    const outlet = outletText
      ? outlets.find((entry) => [entry.id, entry.code, entry.name].some((value) => value?.toLowerCase() === outletText.toLowerCase()))
      : outlets.find((entry) => entry.id === options.outletId);
    if (!outlet) {
      fail(row, outletText ? `Outlet "${outletText}" is not one of this pharmacy's outlets.` : "Choose the destination outlet.", "invalid");
      continue;
    }
    row.outletId = outlet.id;
    row.outletName = outlet.name;
    if (outlet.status === "CLOSED") fail(row, `${outlet.name} is closed.`, "invalid");
    try {
      assertOutletAccess(actor, outlet.id);
    } catch {
      fail(row, `You cannot import into ${outlet.name}. Switch to that outlet or ask a central administrator.`, "invalid");
    }

    const barcode = values.barcode ? normaliseBarcode(values.barcode) : "";
    if (barcode && /^\d+(\.\d+)?e\+?\d+$/i.test(barcode)) fail(row, `Barcode "${barcode}" was turned into a number by Excel. Format the barcode column as text and export again.`, "invalid");
    const sku = values.sku ? values.sku.trim().toUpperCase().replace(/\s+/g, "-") : "";
    if (!row.productName && !barcode && !sku && !values.productId) {
      fail(row, "No product name, barcode or SKU.", "missing");
      continue;
    }
    if (row.productName.length > 120) fail(row, "Product name is longer than 120 characters.", "invalid");

    // Strong matches at this outlet, in priority order.
    const strong: { product: Product; by: string }[] = [];
    if (values.productId) {
      const byId = pool.find((product) => product.id === values.productId);
      if (byId && byId.outletId === outlet.id) strong.push({ product: byId, by: "PharmaERP ID" });
      else if (byId) {
        const sibling = byName.get(`${outlet.id}|${normaliseName(byId.name)}`)?.[0];
        if (sibling) strong.push({ product: sibling, by: "PharmaERP ID (same item at this outlet)" });
        else row.notes.push(`PharmaERP ID belongs to ${byId.name} at another outlet; matched on the other details.`);
      } else row.warnings.push(`PharmaERP ID "${values.productId}" is not an item of this pharmacy and was ignored.`);
    }
    if (barcode) for (const product of byBarcode.get(`${outlet.id}|${barcode}`) ?? []) strong.push({ product, by: "barcode" });
    if (sku) for (const product of bySku.get(`${outlet.id}|${sku}`) ?? []) strong.push({ product, by: "SKU" });
    if (row.productName) for (const product of byName.get(`${outlet.id}|${normaliseName(row.productName)}`) ?? []) strong.push({ product, by: "name" });
    const distinct = [...new Set(strong.map((entry) => entry.product))];

    const fileStrength = `${row.productName} ${values.strength ?? ""}`;
    if (distinct.length === 1) {
      const product = distinct[0];
      const by = strong.filter((entry) => entry.product === product).map((entry) => entry.by);
      row.existing = card(product);
      const theirStrength = `${product.name} ${product.strength !== "-" ? product.strength : ""}`;
      const formClash = values.dosageForm && product.dosageForm && unitKey(values.dosageForm) !== unitKey(product.dosageForm);
      if (strengthsConflict(fileStrength, theirStrength) || formClash) {
        row.action = "review";
        row.candidates = [card(product)];
        row.warnings.push(`Matches ${product.name} by ${by.join(" and ")}, but the ${formClash ? "dosage form" : "strength"} differs. Confirm whether it is the same medicine.`);
        flag(row, "duplicate");
      } else {
        row.action = "match";
        row.productId = product.id;
        row.matchedBy = by.join(" + ");
        if (row.productName && !by.includes("name")) row.notes.push(`Named "${product.name}" in PharmaERP (matched by ${by[0]}).`);
        if (!row.productName) row.productName = product.name;
      }
    } else if (distinct.length > 1) {
      row.action = "review";
      row.candidates = distinct.map(card);
      row.warnings.push(`Barcode, SKU and name point to different products (${distinct.map((product) => product.name).join(", ")}). Choose the right one.`);
      flag(row, "duplicate");
    } else if (row.productName) {
      // Possible duplicates: similar names at this outlet whose strengths do not contradict.
      const seen = new Set<Product>();
      for (const token of nameTokens(row.productName)) for (const product of byToken.get(`${outlet.id}|${token}`) ?? []) seen.add(product);
      const similar = [...seen]
        .map((product) => ({ product, score: nameSimilarity(row.productName, product.name) }))
        .filter(({ product, score }) => score >= 0.5 && !strengthsConflict(fileStrength, `${product.name} ${product.strength !== "-" ? product.strength : ""}`))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (similar.length) {
        row.action = "review";
        row.candidates = similar.map(({ product }) => card(product));
        row.warnings.push(`Possible duplicate of ${similar.map(({ product }) => product.name).join(", ")}. Match it, or create a new product.`);
        flag(row, "duplicate");
      } else row.action = "create";
    } else {
      fail(row, barcode || sku ? `No product with ${barcode ? `barcode ${barcode}` : `SKU ${sku}`} at ${outlet.name}. Add a product name to create it.` : "Product not found.", "missing");
    }
  }

  // 2. Decisions: a decision on one row applies to every row of the same product name at the same outlet.
  const shared = new Map<string, Decision>();
  for (const row of rows) if (row.decision && row.decision.action !== "skip" && row.outletId) shared.set(reviewKey(row), row.decision);
  for (const row of rows) {
    if (row.status === "skipped" || !row.outletId || row.errors.length) continue;
    const decision = row.decision && row.decision.action !== "skip" ? row.decision : row.action === "review" ? shared.get(reviewKey(row)) : undefined;
    if (!decision) continue;
    if (decision.action === "match") {
      const product = pool.find((entry) => entry.id === decision.productId);
      if (!product || product.outletId !== row.outletId) {
        fail(row, "The product you chose is not stocked at this outlet.", "invalid");
        continue;
      }
      row.action = "match";
      row.productId = product.id;
      row.matchedBy = "your choice";
      row.existing = card(product);
      row.warnings = row.warnings.filter((warning) => !warning.includes("Possible duplicate") && !warning.includes("point to different") && !warning.includes("Confirm whether"));
      if (!row.productName) row.productName = product.name;
    } else if (decision.action === "create") {
      const clash = (byName.get(`${row.outletId}|${normaliseName(row.productName)}`) ?? []).find((product) => product.name.toLowerCase() === row.productName.toLowerCase());
      if (clash) {
        fail(row, `${clash.name} already exists at ${row.outletName}. Match it instead, or correct the name.`, "duplicate");
        continue;
      }
      row.action = "create";
      row.warnings = row.warnings.filter((warning) => !warning.includes("Possible duplicate") && !warning.includes("point to different") && !warning.includes("Confirm whether"));
      row.notes.push("New product, as you chose.");
    }
  }
  if (kind === "stock") {
    for (const row of rows) {
      if (row.action === "create") {
        fail(row, `${row.productName} is not in PharmaERP at ${row.outletName}. Import it with the product catalogue first, or choose "Products + opening stock".`, "missing");
        row.action = "none";
      }
    }
  }

  // 3. Groups: one product per group; a group's rows are its batches.
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (row.status === "skipped" || row.action === "none" || row.action === "review") continue;
    row.group = row.action === "match" ? `m|${row.productId}` : `c|${row.outletId}|${normaliseName(row.productName)}`;
    groups.set(row.group, [...(groups.get(row.group) ?? []), row.index]);
  }

  // 4. New products: validate the product details once per group (first row), check the other rows agree.
  const newProducts = new Map<string, ProductPlan>();
  const fileBarcodes = new Map<string, string>();
  const fileSkus = new Map<string, string>();
  const levelsByGroup = new Map<string, LevelSpec[]>();
  for (const [group, indexes] of groups) {
    if (!group.startsWith("c|")) continue;
    const lead = rows[indexes[0]];
    const values = lead.values;
    const problems: string[] = [];
    const warnings: string[] = [];
    const name = lead.productName;
    if (name.length < 2) problems.push("Product name is required for new products.");
    const parsedLevels = fileLevels(values);
    let levels: PackagingLevel[] = [];
    if (parsedLevels.error) problems.push(parsedLevels.error);
    else {
      try {
        levels = buildPackaging(parsedLevels.levels!.map((level) => ({ name: level.name, contains: level.contains })), (index) => `pk${index}`);
        levelsByGroup.set(group, parsedLevels.levels!);
      } catch (error) {
        if (error instanceof PackagingError) problems.push(error.message);
        else throw error;
      }
    }
    if (!parsedLevels.explicit) lead.notes.push(`Single unit "${levels[0]?.name ?? "Unit"}" (no packaging given).`);

    const additions = { categories: [] as string[], dosageForms: [] as string[], productTypes: [] as string[] };
    const category = pickFromList(catalog.categories, values.category, canCatalog, "Category");
    let categoryValue = category.value;
    if (category.error) problems.push(category.error);
    else if (!categoryValue) {
      categoryValue = catalog.categories.find((entry) => entry.toLowerCase() === "others") ?? catalog.categories[0];
      warnings.push(`No category: filed under ${categoryValue}.`);
    }
    if (category.add) additions.categories.push(category.add);
    const form = pickFromList(catalog.dosageForms, values.dosageForm, canCatalog, "Dosage form");
    if (form.error) problems.push(form.error);
    if (form.add) additions.dosageForms.push(form.add);
    const type = pickFromList(catalog.productTypes, values.productType, canCatalog, "Product type");
    if (type.error) problems.push(type.error);
    if (type.add) additions.productTypes.push(type.add);

    // Prices are converted to base-unit prices.
    const quantityLevelUnits = (() => {
      if (record.options?.priceBasis !== "unit" || !parsedLevels.levels) return 1;
      const unitText = values.quantityUnit?.trim();
      if (!unitText) return 1;
      const at = parsedLevels.levels.findIndex((level) => unitKey(level.name) === unitKey(unitText));
      return at >= 0 ? unitsOf(parsedLevels.levels)[at] : 1;
    })();
    const purchase = parseNumber(values.purchasePrice);
    const selling = parseNumber(values.sellingPrice);
    if (purchase.error) problems.push(`Purchase price ${purchase.error}.`);
    if (selling.error) problems.push(`Selling price ${selling.error}.`);
    if (purchase.value === undefined && !purchase.error) problems.push("Purchase price is required for new products.");
    if (selling.value === undefined && !selling.error) problems.push("Selling price is required for new products.");
    if ((purchase.value ?? 0) < 0 || (selling.value ?? 0) < 0) problems.push("Prices cannot be negative.");
    const pricing = { purchasePrice: purchase.value !== undefined ? round4(purchase.value / quantityLevelUnits) : undefined, sellingPrice: selling.value !== undefined ? round4(selling.value / quantityLevelUnits) : undefined };
    if (!problems.length && levels.length) {
      try {
        resolvePricing(levels, pricing);
      } catch (error) {
        if (error instanceof DomainError) problems.push(error.message);
        else throw error;
      }
    }

    const sku = values.sku ? values.sku.trim().toUpperCase().replace(/\s+/g, "-") : "";
    if (sku) {
      if (!/^[A-Z0-9][A-Z0-9-/.]{1,31}$/.test(sku)) problems.push(`SKU "${sku}" may only use letters, numbers, dashes, dots and slashes (2–32 characters).`);
      const owner = products.find((product) => product.sku === sku);
      if (owner && owner.name.toLowerCase() !== name.toLowerCase()) problems.push(`SKU ${sku} is already used by ${owner.name}.`);
      const other = fileSkus.get(sku);
      if (other && other !== name.toLowerCase()) problems.push(`SKU ${sku} is also given to "${other}" in this file.`);
      fileSkus.set(sku, name.toLowerCase());
    }
    const barcode = values.barcode ? normaliseBarcode(values.barcode) : "";
    if (barcode) {
      const problem = barcodeError(barcode, detectBarcodeFormat(barcode));
      if (problem) problems.push(problem);
      const owner = barcodeOwner(barcode);
      if (owner && owner.name.toLowerCase() !== name.toLowerCase()) problems.push(`Barcode ${barcode} already belongs to ${owner.name}.`);
      const other = fileBarcodes.get(barcode);
      if (other && other !== name.toLowerCase()) problems.push(`Barcode ${barcode} is also given to "${other}" in this file.`);
      fileBarcodes.set(barcode, name.toLowerCase());
    }
    const reorder = parseNumber(values.reorderLevel);
    if (reorder.error) problems.push(`Reorder level ${reorder.error}.`);
    else if (reorder.value !== undefined && (reorder.value < 0 || !Number.isInteger(reorder.value))) problems.push("Reorder level must be a whole number of base units.");
    let nafdacNumber: string | undefined;
    try {
      nafdacNumber = normaliseNafdac(values.nafdacNumber);
    } catch {
      warnings.push(`NAFDAC number "${values.nafdacNumber}" is not in the A4-12345 format; recorded as pending.`);
      nafdacNumber = "Pending";
    }
    const supplier = findSupplier(values.supplier);
    if (values.supplier && !supplier) warnings.push(`Supplier "${values.supplier}" is not in Contacts; it is written on the batches only.`);
    if (additions.categories.length || additions.dosageForms.length || additions.productTypes.length) {
      lead.notes.push(`Adds to the catalogue: ${[...additions.categories, ...additions.dosageForms, ...additions.productTypes].join(", ")}.`);
    }
    const elsewhere = pool.find((product) => product.outletId !== lead.outletId && product.name.toLowerCase() === name.toLowerCase());
    if (elsewhere) lead.notes.push(`Already stocked at ${outlets.find((outlet) => outlet.id === elsewhere.outletId)?.name}; this creates the ${lead.outletName} record.`);

    if (problems.length) {
      for (const index of indexes) for (const problem of problems) fail(rows[index], indexes[0] === index ? problem : `Product details (row ${lead.row}): ${problem}`, "invalid");
      continue;
    }
    lead.warnings.push(...warnings);
    lead.incoming = { ...lead.incoming, category: categoryValue, packaging: describeLevels(parsedLevels.levels!), purchasePrice: pricing.purchasePrice, sellingPrice: pricing.sellingPrice, baseUnit: levels[levels.length - 1].name, sku: sku || undefined };
    newProducts.set(group, {
      levels,
      addCatalog: additions,
      input: {
        name,
        sku: sku || undefined,
        genericName: values.genericName || undefined,
        category: categoryValue!,
        productType: type.value,
        dosageForm: form.value,
        strength: values.strength || undefined,
        manufacturer: values.brand || undefined,
        supplierId: supplier?.id,
        outletId: lead.outletId!,
        minStock: reorder.value,
        packaging: parsedLevels.levels!.map((level) => ({ name: level.name, contains: level.contains })),
        pricing,
        barcodeMode: barcode ? "manufacturer" : "none",
        barcodes: barcode ? [{ code: barcode, packagingIndex: parsedLevels.levels!.length - 1 }] : undefined,
        regulatory: { nafdacNumber },
      },
    });
    // The other rows of the product must describe the same product.
    const signature = describeLevels(parsedLevels.levels!);
    for (const index of indexes.slice(1)) {
      const other = rows[index];
      const otherLevels = fileLevels(other.values);
      if (otherLevels.error) fail(other, otherLevels.error, "conversion");
      else if (otherLevels.explicit && describeLevels(otherLevels.levels!) !== signature) fail(other, `Packaging differs from row ${lead.row} (${signature}) for the same product.`, "conversion");
      const otherBarcode = other.values.barcode ? normaliseBarcode(other.values.barcode) : "";
      if (otherBarcode && barcode && otherBarcode !== barcode) fail(other, `Barcode differs from row ${lead.row} for the same product.`, "duplicate");
      const otherSku = other.values.sku ? other.values.sku.trim().toUpperCase().replace(/\s+/g, "-") : "";
      if (otherSku && sku && otherSku !== sku) fail(other, `SKU differs from row ${lead.row} for the same product.`, "duplicate");
      if (strengthsConflict(`${lead.productName} ${values.strength ?? ""}`, `${other.productName} ${other.values.strength ?? ""}`)) {
        fail(other, `Same name as row ${lead.row} but a different strength. Give each medicine its own name.`, "duplicate");
      }
      const otherSelling = parseNumber(other.values.sellingPrice).value;
      if (otherSelling !== undefined && selling.value !== undefined && Math.abs(otherSelling - selling.value) > 0.005) {
        other.warnings.push(`Selling price differs from row ${lead.row}; the product uses ${money(selling.value)}.`);
      }
      other.incoming = { ...lead.incoming };
    }
  }

  // 5. Batches (opening stock), row by row.
  const fileBatches = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "skipped" || !row.group) continue;
    const values = row.values;
    const product = row.action === "match" ? pool.find((entry) => entry.id === row.productId) : undefined;
    const plan = row.action === "create" ? newProducts.get(row.group) : undefined;
    if (row.action === "create" && !plan) continue; // product details invalid, already reported

    if (product && kind === "catalogue") {
      row.notes.push("Already in PharmaERP: left unchanged.");
    }
    if (product && kind !== "stock") {
      const selling = parseNumber(values.sellingPrice).value;
      if (selling !== undefined && product.sellingPrice > 0) {
        const levels = productPackaging(product);
        const unitText = values.quantityUnit?.trim();
        const at = options.priceBasis === "unit" && unitText ? levels.find((level) => unitKey(level.name) === unitKey(unitText)) : undefined;
        const perBase = selling / (at?.unitsPerPackage ?? 1);
        if (Math.abs(perBase - product.sellingPrice) > 0.01) row.warnings.push(`PharmaERP keeps its selling price (${money(product.sellingPrice)} per ${baseUnitName(product)}); the file's price (${money(perBase)}) is not applied.`);
      }
    }
    if (!withStock) continue;

    const hasStock = Boolean(values.batchNumber || values.expiryDate || values.quantity);
    if (!hasStock) {
      if (kind === "stock") fail(row, "No batch details (batch number, expiry date, quantity).", "missing");
      continue;
    }
    const quantity = parseNumber(values.quantity);
    if (quantity.error) {
      fail(row, `Quantity ${quantity.error}.`, "invalid");
      continue;
    }
    if (quantity.value === undefined) {
      fail(row, "Quantity is missing.", "missing");
      continue;
    }
    if (quantity.value < 0) {
      fail(row, "Quantity cannot be negative. Opening stock is what is physically on the shelf.", "invalid");
      continue;
    }
    if (quantity.value === 0) {
      if (kind === "stock") {
        row.status = "skipped";
        row.notes.push("Quantity is 0: nothing to import.");
      } else row.notes.push("Quantity is 0: product only, no batch.");
      continue;
    }
    const batchNumber = (values.batchNumber ?? "").trim().toUpperCase();
    if (!batchNumber) fail(row, "Batch number is missing. Every batch of stock needs its own batch number.", "missing");
    else if (batchNumber.length > 40) fail(row, "Batch number is longer than 40 characters.", "invalid");
    const expiry = parseDate(values.expiryDate, options.dateFormat, "expiry");
    if (expiry.error) fail(row, `Expiry date ${expiry.error}.`, "invalid");
    else if (!expiry.value) fail(row, "Expiry date is missing.", "missing");
    const made = parseDate(values.manufacturingDate, options.dateFormat, "other");
    if (made.error) fail(row, `Manufacturing date ${made.error}.`, "invalid");
    if (expiry.value) {
      if (expiry.value <= today) fail(row, `Batch expired on ${expiry.value}. Expired stock cannot be imported as saleable stock; record it through Expiry Management.`, "expired");
      else {
        const days = Math.round((Date.parse(expiry.value) - Date.parse(today)) / 86_400_000);
        if (days <= nearDays) {
          row.warnings.push(`Near expiry: ${days} day(s) left.`);
          flag(row, "nearExpiry");
        }
      }
      if (made.value && made.value >= expiry.value) fail(row, "Expiry date must be after the manufacturing date.", "invalid");
    }
    if (made.value && made.value > today) fail(row, "Manufacturing date cannot be in the future.", "invalid");
    if (product && (product.lifecycle ?? "ACTIVE") === "DISCONTINUED") fail(row, `${product.name} is discontinued and cannot receive stock.`, "invalid");

    // Conversion with this product's own packaging.
    let levels: { name: string; unitsPerPackage: number }[];
    if (product) {
      const configured = productPackaging(product);
      levels = configured;
      const file = fileLevels(values);
      if (file.error) fail(row, file.error, "conversion");
      else if (file.levels && file.levels.length > 1) {
        const units = unitsOf(file.levels);
        file.levels.forEach((level, at) => {
          const match = configured.find((entry) => unitKey(entry.name) === unitKey(level.name));
          if (!match) row.warnings.push(`Packaging level "${level.name}" in the file is not set up for ${product.name}; ignored.`);
          else if (match.unitsPerPackage !== units[at]) {
            fail(row, `The file says 1 ${level.name} = ${units[at]} ${file.levels![file.levels!.length - 1].name}, but PharmaERP has 1 ${match.name} = ${match.unitsPerPackage} ${baseUnitName(product)} for ${product.name}. Fix the packaging before importing.`, "conversion");
          }
        });
      }
    } else levels = plan!.levels;
    const base = levels[levels.length - 1];
    const unitText = values.quantityUnit?.trim() || (product && values.baseUnit?.trim()) || "";
    const level = unitText ? levels.find((entry) => unitKey(entry.name) === unitKey(unitText)) : base;
    if (!level) {
      fail(row, `Unit "${unitText}" is not a packaging level of ${row.productName} (set up: ${levels.map((entry) => entry.name).join(", ")}).`, "conversion");
      continue;
    }
    const baseQuantity = quantity.value * level.unitsPerPackage;
    if (Math.abs(baseQuantity - Math.round(baseQuantity)) > 1e-9) {
      fail(row, `${quantity.value} ${level.name} is not a whole number of ${base.name} (${round4(baseQuantity)}).`, "conversion");
      continue;
    }
    if (baseQuantity > 10_000_000) fail(row, "Quantity is unrealistically large.", "invalid");

    // Cost of this batch per base unit.
    const purchase = parseNumber(values.purchasePrice);
    if (purchase.error) fail(row, `Purchase price ${purchase.error}.`, "invalid");
    let unitCost: number;
    if (purchase.value !== undefined && purchase.value > 0) unitCost = round4(purchase.value / (options.priceBasis === "unit" ? level.unitsPerPackage : 1));
    else unitCost = product ? product.purchasePrice : plan!.input.pricing.purchasePrice ?? 0;
    if (purchase.value !== undefined && purchase.value < 0) fail(row, "Purchase price cannot be negative.", "invalid");

    if (batchNumber) {
      const key = `${row.group}|${batchNumber}`;
      const earlier = fileBatches.get(key);
      if (earlier !== undefined) fail(row, `Batch ${batchNumber} is listed twice for this product (row ${earlier}). Batches are never combined: remove the duplicate or correct the batch number.`, "duplicate");
      else fileBatches.set(key, row.row);
      const existingBatch = product && batches.find((entry) => entry.productId === product.id && entry.batchNumber.toUpperCase() === batchNumber);
      if (existingBatch) fail(row, `Batch ${batchNumber} of ${product!.name} is already in PharmaERP (received ${existingBatch.receivingDate}). Use Stock Receiving or a stock adjustment for more of it.`, "duplicate");
    }
    row.batch = {
      batchNumber,
      expiryDate: expiry.value ?? "",
      manufacturingDate: made.value,
      quantity: quantity.value,
      unit: level.name,
      baseQuantity: Math.round(baseQuantity),
      baseUnit: base.name,
      unitCost,
      conversion: level.unitsPerPackage === 1 ? `${quantity.value.toLocaleString("en-NG")} ${base.name}` : `${quantity.value.toLocaleString("en-NG")} ${level.name} × ${level.unitsPerPackage.toLocaleString("en-NG")} = ${Math.round(baseQuantity).toLocaleString("en-NG")} ${base.name}`,
    };
  }

  // 6. Status and summary.
  const summary: PreviewSummary = {
    totalRows: rows.length,
    readyRows: 0,
    warningRows: 0,
    reviewRows: 0,
    errorRows: 0,
    skippedRows: 0,
    newProducts: 0,
    matchedProducts: 0,
    newBatches: 0,
    openingQuantity: 0,
    duplicateWarnings: 0,
    invalidRows: 0,
    missingRequired: 0,
    conversionIssues: 0,
    expiredRows: 0,
    nearExpiryRows: 0,
    newCategories: [],
    chunks: 0,
  };
  const createGroups = new Set<string>();
  const matchGroups = new Set<string>();
  for (const row of rows) {
    if (row.status !== "skipped") row.status = row.errors.length ? "error" : row.action === "review" ? "review" : row.warnings.length ? "warning" : "ready";
    const counter = ({ ready: "readyRows", warning: "warningRows", review: "reviewRows", error: "errorRows", skipped: "skippedRows" } as const)[row.status];
    summary[counter] += 1;
    if (row.flags.includes("duplicate")) summary.duplicateWarnings += 1;
    if (row.flags.includes("missing")) summary.missingRequired += 1;
    if (row.flags.includes("conversion")) summary.conversionIssues += 1;
    if (row.flags.includes("expired")) summary.expiredRows += 1;
    if (row.flags.includes("nearExpiry")) summary.nearExpiryRows += 1;
    if (row.status === "error") summary.invalidRows += 1;
    if (row.status !== "ready" && row.status !== "warning") continue;
    if (row.action === "create" && row.group) createGroups.add(row.group);
    if (row.action === "match" && row.group) matchGroups.add(row.group);
    if (row.batch && withStock) {
      summary.newBatches += 1;
      summary.openingQuantity += row.batch.baseQuantity;
    }
  }
  summary.newProducts = createGroups.size;
  summary.matchedProducts = matchGroups.size;
  summary.newCategories = [...new Set([...newProducts.entries()].filter(([group]) => createGroups.has(group)).flatMap(([, plan]) => [...plan.addCatalog.categories, ...plan.addCatalog.dosageForms, ...plan.addCatalog.productTypes]))];
  return { rows, groups, newProducts, summary };
}

const importable = (row: PreviewRow) => (row.status === "ready" || row.status === "warning") && (row.action === "create" || row.action === "match");

/** Rows with work to do, in chunks of whole products. */
function buildPlan(analysis: Analysis, kind: ImportKind): Plan {
  const plan: Plan = { rows: {}, chunks: [], reviewRows: analysis.summary.reviewRows };
  let current: number[] = [];
  const limit = chunkRows();
  for (const indexes of analysis.groups.values()) {
    const rows = indexes.map((index) => analysis.rows[index]).filter(importable);
    // Matched products in a catalogue import, and product-only rows of matched products, have nothing to write.
    const work = rows.filter((row) => row.action === "create" || (kind !== "catalogue" && row.batch));
    if (!work.length) continue;
    if (current.length && current.length + work.length > limit) {
      plan.chunks.push(current);
      current = [];
    }
    for (const row of work) {
      plan.rows[String(row.index)] = { a: row.action as "create" | "match", p: row.action === "match" ? row.productId : undefined };
      current.push(row.index);
    }
  }
  if (current.length) plan.chunks.push(current);
  analysis.summary.chunks = plan.chunks.length;
  return plan;
}

// ---------------------------------------------------------------- public views

function meta(record: ImportRecord) {
  return {
    id: record.id,
    reference: record.reference,
    kind: record.kind,
    kindLabel: IMPORT_KIND_LABELS[record.kind],
    status: record.status,
    fileName: record.fileName,
    fileSize: record.fileSize,
    rowCount: record.rowCount,
    outletId: record.outletId,
    outletName: record.outletId ? outlets.find((outlet) => outlet.id === record.outletId)?.name ?? record.outletId : null,
    createdByName: record.createdByName,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    rolledBackAt: record.rolledBackAt,
    rolledBackBy: record.rolledBackBy,
    rollbackReason: record.rollbackReason,
    nextChunk: record.nextChunk,
    chunkCount: record.chunkCount,
    summary: record.summary,
  };
}

async function previousImportOf(record: Pick<ImportRecord, "id" | "fileHash" | "kind">) {
  const [row] = await runSql<{ reference: string; status: string; completed_at: Date | null; created_at: Date }>(
    `SELECT reference, status, completed_at, created_at FROM inventory_imports WHERE tenant_id = $1 AND file_hash = $2 AND kind = $3 AND status IN ('IN_PROGRESS', 'COMPLETED') AND id <> $4 ORDER BY created_at DESC LIMIT 1`,
    [currentTenantId(), record.fileHash, record.kind, record.id],
  );
  return row ? { reference: row.reference, status: row.status, at: isoOrNull(row.completed_at ?? row.created_at) } : null;
}

function previewView(record: ImportRecord, analysis: Analysis) {
  return { summary: analysis.summary, rows: analysis.rows, token: record.planToken };
}

/** State for the import screen. */
export async function importDetail(actor: Actor, id: string) {
  assertCan(actor, "inventory.import");
  const record = await loadImport(actor, id);
  const auto = autoMap(record.headers, record.kind);
  const editable = record.status === "DRAFT" || record.status === "PREVIEWED";
  return {
    ...meta(record),
    headers: record.headers,
    sample: record.rows.slice(0, 5),
    mapping: record.status === "DRAFT" && !Object.keys(record.mapping).length ? auto.mapping : record.mapping,
    suggestions: auto.suggestions,
    options: record.options,
    edits: record.edits,
    decisions: record.decisions,
    previous: await previousImportOf(record),
    token: record.status === "PREVIEWED" || record.status === "IN_PROGRESS" ? record.planToken : null,
    preview: editable && record.options && record.status === "PREVIEWED" ? previewView(record, analyse(record, actor)) : null,
    results: Object.values(record.results).sort((a, b) => a.row - b.row),
  };
}

export async function listImports(actor: Actor) {
  assertCan(actor, "inventory.import");
  const rows = await runSql<DbRow>(
    `SELECT id, reference, kind, status, file_name, file_hash, file_size, row_count, outlet_id, summary, created_by_id, created_by_name, created_at, started_at, completed_at, rolled_back_at, rolled_back_by, rollback_reason, next_chunk, chunk_count, created
       FROM inventory_imports WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 300`,
    [currentTenantId()],
  );
  return rows.map(fromDb).filter((record) => visibleTo(actor, record)).map(meta);
}

// ---------------------------------------------------------------- upload, preview

export async function createImport(actor: Actor, input: { kind: string; fileName: string; bytes: Uint8Array }) {
  assertImporter(actor);
  if (!IMPORT_KINDS.includes(input.kind as ImportKind)) throw new DomainError("Choose what to import: products, opening stock, or both.");
  const kind = input.kind as ImportKind;
  const fileName = (input.fileName.split(/[\\/]/).pop() ?? "import").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "import";
  const sheet = await readImportFile(fileName, input.bytes);
  const id = newId("imp", randomUUID().replace(/-/g, "").slice(0, 16));
  const reference = `IMP-${String(nextNumber("import")).padStart(5, "0")}`;
  const auto = autoMap(sheet.headers, kind);
  const outletId = actor.outletId ?? null;
  await runSql(
    `INSERT INTO inventory_imports (id, tenant_id, reference, kind, status, file_name, file_hash, file_size, row_count, outlet_id, data, mapping, created_by_id, created_by_name)
     VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
    [id, currentTenantId(), reference, kind, fileName, fileHash(input.bytes), input.bytes.length, sheet.rows.length, outletId, JSON.stringify(sheet), JSON.stringify(auto.mapping), actor.id, actor.name],
  );
  recordAudit(actor, { action: "inventory.import.upload", entity: "InventoryImport", entityId: reference, summary: `Uploaded ${fileName} for ${IMPORT_KIND_LABELS[kind].toLowerCase()} import ${reference} (${sheet.rows.length} rows)`, outletId });
  return importDetail(actor, id);
}

const optionsSchema = (input: unknown): ImportOptions => {
  const value = (input ?? {}) as Partial<ImportOptions>;
  if (typeof value.outletId !== "string" || !value.outletId) throw new DomainError("Choose the destination outlet.");
  return { outletId: value.outletId, dateFormat: value.dateFormat === "MDY" ? "MDY" : "DMY", priceBasis: value.priceBasis === "unit" ? "unit" : "base" };
};

export type PreviewInput = { kind?: string; mapping?: Record<string, unknown>; options?: unknown; edits?: Record<string, Record<string, unknown>>; decisions?: Record<string, unknown> };

export async function previewImport(actor: Actor, id: string, input: PreviewInput) {
  assertImporter(actor);
  const record = await loadImport(actor, id, true);
  if (record.status !== "DRAFT" && record.status !== "PREVIEWED") throw new DomainError(`Import ${record.reference} is ${record.status.toLowerCase().replace("_", " ")} and can no longer be changed.`, 409);
  if (input.kind !== undefined) {
    if (!IMPORT_KINDS.includes(input.kind as ImportKind)) throw new DomainError("Unknown import type.");
    record.kind = input.kind as ImportKind;
  }
  // Column mapping: only this import type's fields, each to a column of the file.
  const allowed = new Set(fieldsFor(record.kind).map((field) => field.key));
  const mapping: Mapping = {};
  for (const [key, column] of Object.entries(input.mapping ?? record.mapping)) {
    if (column === null || column === undefined || column === "") continue;
    if (!allowed.has(key as FieldKey)) continue;
    mapping[key as FieldKey] = Number(column);
  }
  const problems = mappingProblems(record.kind, mapping, record.headers.length);
  if (problems.length) throw new DomainError(problems.join(" "));
  const options = optionsSchema(input.options ?? record.options);
  const outlet = outlets.find((entry) => entry.id === options.outletId);
  if (!outlet) throw new DomainError("The destination outlet is not one of this pharmacy's outlets.", 404);
  assertOutletAccess(actor, outlet.id);

  // Corrections typed on the preview, and duplicate decisions.
  const edits: Record<string, Values> = {};
  for (const [rowKey, fields] of Object.entries(input.edits ?? record.edits)) {
    const index = Number(rowKey);
    if (!Number.isInteger(index) || index < 0 || index >= record.rows.length) continue;
    const row: Values = {};
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (!FIELD_KEYS.includes(key as FieldKey) || typeof value !== "string") continue;
      row[key as FieldKey] = value.slice(0, 500);
    }
    if (Object.keys(row).length) edits[String(index)] = row;
  }
  const decisions: Record<string, Decision> = {};
  for (const [rowKey, value] of Object.entries(input.decisions ?? record.decisions)) {
    const index = Number(rowKey);
    const decision = value as Partial<Decision> | null;
    if (!Number.isInteger(index) || index < 0 || index >= record.rows.length || !decision) continue;
    if (decision.action === "skip" || decision.action === "create") decisions[String(index)] = { action: decision.action };
    else if (decision.action === "match" && typeof (decision as { productId?: unknown }).productId === "string") decisions[String(index)] = { action: "match", productId: (decision as { productId: string }).productId };
  }

  Object.assign(record, { mapping, options, edits, decisions, outletId: outlet.id });
  const analysis = analyse(record, actor);
  const plan = buildPlan(analysis, record.kind);
  record.planToken = randomUUID();
  record.status = "PREVIEWED";
  await saveImport(record.id, { kind: record.kind, mapping, options, edits, decisions, outlet_id: outlet.id, plan, plan_token: record.planToken, chunk_count: plan.chunks.length, status: "PREVIEWED", summary: analysis.summary });
  return {
    ...meta({ ...record, chunkCount: plan.chunks.length, summary: analysis.summary as unknown as Record<string, unknown> }),
    previous: await previousImportOf(record),
    preview: previewView(record, analysis),
  };
}

export async function cancelImport(actor: Actor, id: string) {
  assertImporter(actor);
  const record = await loadImport(actor, id, true);
  if (record.status !== "DRAFT" && record.status !== "PREVIEWED") throw new DomainError("Only imports that have not started can be discarded.", 409);
  await saveImport(id, { status: "CANCELLED", data: { headers: record.headers, rows: [], rowNumbers: [] } });
  recordAudit(actor, { action: "inventory.import.cancel", entity: "InventoryImport", entityId: record.reference, summary: `Discarded import ${record.reference} (${record.fileName}) before it started`, outletId: record.outletId });
  return { id, status: "CANCELLED" };
}

// ---------------------------------------------------------------- commit

function resultFor(row: PreviewRow, status: RowResult["status"], extra: Partial<RowResult> = {}): RowResult {
  return {
    row: row.row,
    status,
    action: row.action === "create" || row.action === "match" ? row.action : undefined,
    productId: row.productId,
    productName: row.productName,
    outletName: row.outletName,
    batchNumber: row.batch?.batchNumber,
    expiryDate: row.batch?.expiryDate,
    quantity: row.batch?.quantity,
    unit: row.batch?.unit,
    baseQuantity: row.batch?.baseQuantity,
    baseUnit: row.batch?.baseUnit,
    messages: [...row.errors, ...row.warnings, ...row.notes],
    ...extra,
  };
}

function totals(record: ImportRecord) {
  const results = Object.values(record.results);
  const imported = results.filter((row) => row.status === "imported");
  return {
    processedRows: results.length,
    productsCreated: record.created.products.length,
    productsMatched: new Set(results.filter((row) => row.action === "match" && row.status !== "rejected" && row.status !== "skipped").map((row) => row.productId)).size,
    batchesCreated: record.created.batches.length + record.created.stockBatches.length,
    quantityImported: imported.reduce((sum, row) => sum + (row.batchId ? row.baseQuantity ?? 0 : 0), 0),
    rowsSkipped: results.filter((row) => row.status === "skipped").length,
    rowsRejected: results.filter((row) => row.status === "rejected").length,
    rowsWithWarnings: results.filter((row) => row.status !== "rejected" && row.messages.length > 0).length,
    catalogueAdded: [...record.created.catalog.categories, ...record.created.catalog.dosageForms, ...record.created.catalog.productTypes],
  };
}

export async function commitImport(actor: Actor, id: string, input: { confirm?: boolean; token?: string; chunk?: number }) {
  assertImporter(actor);
  const record = await loadImport(actor, id, true);
  const chunk = Number(input.chunk ?? 0);
  if (record.status === "COMPLETED" || (record.status === "IN_PROGRESS" && chunk < record.nextChunk)) {
    // A repeated request (double click, retry after a timeout): nothing is imported twice.
    return { ...meta(record), done: record.status === "COMPLETED", repeated: true };
  }
  if (record.status !== "PREVIEWED" && record.status !== "IN_PROGRESS") throw new DomainError(`Import ${record.reference} is ${record.status.toLowerCase().replace("_", " ")}.`, 409);
  if (input.confirm !== true) throw new DomainError("Confirm the import to continue.");
  if (!record.plan || !record.planToken || input.token !== record.planToken) throw new DomainError("The preview has changed since you reviewed it. Check the preview again, then confirm.", 409);
  if (chunk !== record.nextChunk) throw new DomainError(`Part ${chunk + 1} cannot run before part ${record.nextChunk + 1}.`, 409);
  if (record.status === "PREVIEWED") {
    // The same file, imported the same way, may not be imported again while that import stands.
    const previous = await previousImportOf(record);
    if (previous) throw new DomainError(`This file was already imported as ${previous.reference}${previous.at ? ` on ${previous.at.slice(0, 10)}` : ""}. Roll that import back first if you need to import it again.`, 409);
  }
  if (!record.plan.chunks.length) throw new DomainError("Nothing to import: every row is rejected, skipped or already in PharmaERP.");

  const exclude = new Set(record.created.products);
  const analysis = analyse(record, actor, exclude);
  if (record.status === "PREVIEWED") {
    if (record.plan.reviewRows > 0 || analysis.summary.reviewRows > 0) throw new DomainError(`${analysis.summary.reviewRows || record.plan.reviewRows} row(s) are possible duplicates. Decide on each one before importing.`);
    // Rows that will not be imported are reported now.
    for (const row of analysis.rows) {
      if (record.plan.rows[String(row.index)]) continue;
      record.results[String(row.index)] = row.status === "skipped" ? resultFor(row, "skipped") : row.status === "error" || row.status === "review" ? resultFor(row, "rejected") : resultFor(row, row.action === "match" ? "matched" : "skipped");
    }
    record.status = "IN_PROGRESS";
    await saveImport(record.id, { status: "IN_PROGRESS", started_at: NOW });
  }

  // The rows of this part must still be exactly what the user confirmed.
  const indexes = record.plan.chunks[chunk];
  for (const index of indexes) {
    const fresh = analysis.rows[index];
    const confirmed = record.plan.rows[String(index)];
    if (!importable(fresh) || fresh.action !== confirmed.a || (confirmed.a === "match" && fresh.productId !== confirmed.p)) {
      const why = fresh.errors[0] ?? fresh.warnings[0] ?? (fresh.action !== confirmed.a ? `now ${fresh.action === "match" ? `matches ${fresh.productName}` : fresh.action}` : "changed");
      throw new DomainError(
        `Row ${fresh.row} (${fresh.productName}) changed since the preview: ${why}. ${chunk === 0 ? "Check the preview again before importing." : `Parts 1–${chunk} are already imported: roll this import back from Import History and start again, or contact support.`}`,
        409,
      );
    }
  }

  const reference = record.reference;
  const remarks = `Opening stock import ${reference} (${record.fileName})`;
  const store = getStore();
  const byGroup = new Map<string, PreviewRow[]>();
  for (const index of indexes) {
    const row = analysis.rows[index];
    byGroup.set(row.group!, [...(byGroup.get(row.group!) ?? []), row]);
  }
  for (const [group, rows] of byGroup) {
    if (group.startsWith("c|")) {
      const plan = analysis.newProducts.get(group)!;
      // Catalogue entries this product needs (allowed for central administrators only; checked in analyse).
      const catalog = { ...store.settings.catalog };
      for (const key of ["categories", "dosageForms", "productTypes"] as const) {
        for (const entry of plan.addCatalog[key]) {
          if (catalog[key].some((existing) => existing.toLowerCase() === entry.toLowerCase())) continue;
          catalog[key] = [...catalog[key], entry];
          record.created.catalog[key].push(entry);
        }
      }
      store.settings.catalog = catalog;
      const opening: OpeningBatchInput[] = rows
        .filter((row) => row.batch)
        .map((row) => {
          const batch = row.batch!;
          const levelIndex = plan.levels.findIndex((level) => level.name === batch.unit);
          const whole = levelIndex >= 0 && Number.isInteger(batch.quantity);
          const supplier = findSupplier(row.values.supplier);
          return {
            batchNumber: batch.batchNumber,
            manufacturingDate: batch.manufacturingDate ?? "",
            expiryDate: batch.expiryDate,
            supplierId: supplier?.id,
            supplierName: supplier ? undefined : row.values.supplier,
            supplierBatchRef: row.values.supplierRef,
            packagingIndex: whole ? levelIndex : plan.levels.length - 1,
            quantity: whole ? batch.quantity : batch.baseQuantity,
            unitCost: round4(batch.unitCost * (whole ? plan.levels[levelIndex].unitsPerPackage : 1)),
          };
        });
      const registered = store.registrations.some((entry) => entry.productName.toLowerCase() === plan.input.name.toLowerCase());
      const product = registerProduct(actor, { ...plan.input, openingStock: opening }, { reference, remarks, quiet: true });
      record.created.products.push(product.id);
      const newBatches = batches.filter((batch) => batch.productId === product.id);
      record.created.batches.push(...newBatches.map((batch) => batch.id));
      record.created.ledger.push(...store.stockLedger.filter((entry) => entry.productId === product.id).map((entry) => entry.id));
      record.created.prices.push(...store.priceHistory.filter((entry) => entry.productId === product.id).map((entry) => entry.id));
      if (!registered) {
        const registration = store.registrations.find((entry) => entry.productName.toLowerCase() === plan.input.name.toLowerCase());
        if (registration) record.created.registrations.push(registration.id);
      }
      for (const row of rows) {
        const batch = row.batch ? newBatches.find((entry) => entry.batchNumber === row.batch!.batchNumber) : undefined;
        record.results[String(row.index)] = resultFor(row, "imported", { productId: product.id, batchId: batch?.id });
      }
    } else {
      const product = products.find((entry) => entry.id === rows[0].productId)!;
      const levels = productPackaging(product);
      for (const row of rows) {
        const batch = row.batch!;
        const level = levels.find((entry) => entry.name === batch.unit) ?? levels[levels.length - 1];
        const supplier = findSupplier(row.values.supplier);
        const { batch: created, entry } = receiveIntoNewBatch(
          actor,
          product,
          {
            batchNumber: batch.batchNumber,
            manufacturingDate: batch.manufacturingDate ?? "",
            expiryDate: batch.expiryDate,
            supplier: supplier?.name ?? (row.values.supplier || "Opening stock"),
            supplierId: supplier?.id,
            supplierBatchRef: row.values.supplierRef || undefined,
            regulatoryNumber: product.nafdacNumber && product.nafdacNumber !== "Pending" ? product.nafdacNumber : undefined,
            unitCost: batch.unitCost,
          },
          { type: "OPENING", baseQuantity: batch.baseQuantity, reference, remarks, unit: { name: level.name, unitsPerPackage: level.unitsPerPackage } },
        );
        record.created.stockBatches.push(created.id);
        record.created.ledger.push(entry.id);
        record.results[String(row.index)] = resultFor(row, "imported", { productId: product.id, batchId: created.id });
      }
    }
  }

  record.nextChunk = chunk + 1;
  const done = record.nextChunk >= record.plan.chunks.length;
  record.status = done ? "COMPLETED" : "IN_PROGRESS";
  const summary = totals(record);
  record.summary = summary;
  await saveImport(record.id, { next_chunk: record.nextChunk, status: record.status, results: record.results, created: record.created, summary, ...(done ? { completed_at: NOW } : {}) });
  const partLabel = record.plan.chunks.length > 1 ? ` (part ${chunk + 1} of ${record.plan.chunks.length})` : "";
  recordAudit(actor, {
    action: "inventory.import.commit",
    entity: "InventoryImport",
    entityId: reference,
    summary: `${done ? "Completed" : "Committed"} import ${reference}${partLabel} from ${record.fileName}: ${summary.productsCreated} product(s) created, ${summary.productsMatched} matched, ${summary.batchesCreated} batch(es), ${summary.quantityImported.toLocaleString()} base unit(s) of opening stock so far; ${summary.rowsRejected} row(s) rejected`,
    outletId: record.outletId,
    severity: "warning",
  });
  if (done) record.completedAt = new Date().toISOString();
  return { ...meta(record), done };
}

// ---------------------------------------------------------------- rollback

function removeWhere<T>(list: T[], remove: (item: T) => boolean) {
  for (let index = list.length - 1; index >= 0; index -= 1) if (remove(list[index])) list.splice(index, 1);
}

export async function rollbackImport(actor: Actor, id: string, reason: string) {
  assertImporter(actor);
  assertCan(actor, "stock.approve");
  const record = await loadImport(actor, id, true);
  if (record.status !== "COMPLETED" && record.status !== "IN_PROGRESS") throw new DomainError(`Import ${record.reference} is ${record.status.toLowerCase().replace("_", " ")}; there is nothing to roll back.`, 409);
  const why = (reason ?? "").trim();
  if (why.length < 5) throw new DomainError("Give a reason for the rollback (at least 5 characters).");
  const store = getStore();
  const created = record.created;
  const ours = new Set(created.ledger);
  const productIds = new Set(created.products);
  const problems: string[] = [];

  // Nothing the import created may have been used since: no sale, transfer, adjustment, receipt or edit.
  for (const batchId of [...created.batches, ...created.stockBatches]) {
    const batch = batches.find((entry) => entry.id === batchId);
    if (!batch) {
      problems.push(`A batch created by the import no longer exists.`);
      continue;
    }
    const later = store.stockLedger.filter((entry) => entry.batchId === batchId && !ours.has(entry.id));
    if (later.length) problems.push(`${batch.productName} batch ${batch.batchNumber}: ${[...new Set(later.map((entry) => entry.type.toLowerCase().replace(/_/g, " ")))].join(", ")} since the import.`);
    else if (batch.disposition) problems.push(`${batch.productName} batch ${batch.batchNumber} has been quarantined or set for return/disposal.`);
  }
  for (const productId of productIds) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) {
      problems.push("A product created by the import no longer exists.");
      continue;
    }
    const used =
      store.stockLedger.some((entry) => entry.productId === productId && !ours.has(entry.id)) ||
      store.sales.some((sale) => sale.lines.some((line) => line.productId === productId)) ||
      store.saleReturns.some((entry) => entry.lines.some((line) => line.productId === productId)) ||
      store.purchaseOrders.some((order) => order.lines.some((line) => line.productId === productId)) ||
      store.transfers.some((transfer) => transfer.lines.some((line) => line.productId === productId)) ||
      store.heldSales.some((held) => held.cart?.lines?.some((line) => line.productId === productId)) ||
      stockMovements.some((movement) => movement.productId === productId);
    if (used) problems.push(`${product.name} has been sold, ordered, transferred or received since the import.`);
    else if (store.priceHistory.some((entry) => entry.productId === productId && !created.prices.includes(entry.id))) problems.push(`${product.name} has been edited (prices) since the import.`);
  }
  if (problems.length) {
    const list = problems.slice(0, 8).join(" ");
    throw new DomainError(
      `Import ${record.reference} cannot be rolled back safely: ${list}${problems.length > 8 ? ` …and ${problems.length - 8} more.` : ""} Rolling back would remove stock that has since been used. Record a corrective stock adjustment for the affected items instead.`,
      409,
    );
  }

  // Stock added to products that already existed: reversed through the ledger (their history stays).
  const reversalRemarks = `Rollback of import ${record.reference}: ${why}`;
  let reversed = 0;
  for (const batchId of created.stockBatches) {
    const batch = batches.find((entry) => entry.id === batchId) as BatchRecord;
    const product = products.find((entry) => entry.id === batch.productId);
    if (!product || batch.availableQuantity <= 0) continue;
    reversed += batch.availableQuantity;
    postStock(actor, { type: "ADJUSTMENT_OUT", product, batch, baseQuantity: batch.availableQuantity, reference: record.reference, remarks: reversalRemarks });
  }
  // Products the import created (with their own batches and opening rows) are removed entirely.
  const removedBatches = new Set(created.batches);
  removeWhere(store.stockLedger, (entry) => productIds.has(entry.productId));
  removeWhere(store.priceHistory, (entry) => productIds.has(entry.productId));
  removeWhere(store.alerts, (entry) => productIds.has(entry.productId) || (entry.batchId !== undefined && removedBatches.has(entry.batchId)));
  removeWhere(batches, (batch) => productIds.has(batch.productId));
  const removedNames = new Set(products.filter((product) => productIds.has(product.id)).map((product) => product.name.toLowerCase()));
  removeWhere(products, (product) => productIds.has(product.id));
  removeWhere(store.registrations, (entry) => created.registrations.includes(entry.id) && !products.some((product) => product.name.toLowerCase() === entry.productName.toLowerCase()));
  // Catalogue entries the import added, unless something else uses them now.
  const catalog = { ...store.settings.catalog };
  catalog.categories = catalog.categories.filter((entry) => !created.catalog.categories.includes(entry) || products.some((product) => product.category === entry));
  catalog.dosageForms = catalog.dosageForms.filter((entry) => !created.catalog.dosageForms.includes(entry) || products.some((product) => product.dosageForm === entry));
  catalog.productTypes = catalog.productTypes.filter((entry) => !created.catalog.productTypes.includes(entry) || products.some((product) => product.productType === entry));
  store.settings.catalog = catalog;

  await saveImport(record.id, { status: "ROLLED_BACK", rolled_back_at: NOW, rolled_back_by: actor.name, rollback_reason: why.slice(0, 500) });
  recordAudit(actor, {
    action: "inventory.import.rollback",
    entity: "InventoryImport",
    entityId: record.reference,
    summary: `Rolled back import ${record.reference} (${record.fileName}): removed ${productIds.size} product(s) it created (${removedNames.size} name(s)) with ${created.batches.length} batch(es); reversed ${created.stockBatches.length} batch(es) on existing products (${reversed.toLocaleString()} base unit(s)). Reason: ${why}`,
    outletId: record.outletId,
    severity: "critical",
  });
  return { ...meta({ ...record, status: "ROLLED_BACK", rolledBackAt: new Date().toISOString(), rolledBackBy: actor.name, rollbackReason: why }), removedProducts: productIds.size, reversedBatches: created.stockBatches.length };
}

// ---------------------------------------------------------------- reports

/** CSV reports: "rejected" (rows to correct, with the original columns), "success", or "all" results. */
export async function importReport(actor: Actor, id: string, type: string) {
  assertCan(actor, "inventory.import");
  const record = await loadImport(actor, id);
  const committed = Object.keys(record.results).length > 0;
  const analysis = !committed && record.options && record.status !== "CANCELLED" ? analyse(record, actor) : null;
  let rows: unknown[][];
  if (type === "rejected") {
    const rejected = committed
      ? Object.entries(record.results).filter(([, result]) => result.status === "rejected").map(([index, result]) => ({ index: Number(index), messages: result.messages }))
      : (analysis?.rows ?? []).filter((row) => row.status === "error" || row.status === "review").map((row) => ({ index: row.index, messages: [...row.errors, ...row.warnings] }));
    rows = [
      ["Row", ...record.headers, "Problems"],
      ...rejected
        .sort((a, b) => a.index - b.index)
        .map(({ index, messages }) => {
          const cells = [...(record.rows[index] ?? [])];
          // Corrections typed on the preview go back into their columns.
          for (const [key, value] of Object.entries(record.edits[String(index)] ?? {}) as [FieldKey, string][]) {
            const column = record.mapping[key];
            if (column !== undefined) cells[column] = value;
          }
          return [record.rowNumbers[index] ?? index + 2, ...cells, messages.join(" | ")];
        }),
    ];
  } else {
    const results = committed ? Object.values(record.results) : (analysis?.rows ?? []).map((row) => resultFor(row, row.status === "error" || row.status === "review" ? "rejected" : row.status === "skipped" ? "skipped" : "imported"));
    const chosen = type === "success" ? results.filter((row) => row.status === "imported" || row.status === "matched") : results;
    rows = [
      ["Row", "Result", "Action", "Product", "PharmaERP ID", "Outlet", "Batch", "Expiry", "Quantity", "Unit", "Base quantity", "Base unit", "Messages"],
      ...chosen.sort((a, b) => a.row - b.row).map((row) => [row.row, row.status, row.action ?? "", row.productName, row.productId ?? "", row.outletName ?? "", row.batchNumber ?? "", row.expiryDate ?? "", row.quantity ?? "", row.unit ?? "", row.baseQuantity ?? "", row.baseUnit ?? "", row.messages.join(" | ")]),
    ];
  }
  const name = `${record.reference}-${type === "rejected" ? "rejected-rows" : type === "success" ? "imported" : "report"}.csv`;
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
