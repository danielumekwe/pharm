// Product registration: master data, packaging, barcodes, pricing, regulatory details and opening stock.

import { batches, outlets, products, stockMovements, type Product } from "@/lib/data";
import { baseUnitName, ledgerFor, receiveIntoNewBatch, summarise } from "@/lib/erp/ledger";
import {
  barcodeError,
  baseLevel,
  describeBreakdown,
  buildPackaging,
  detectBarcodeFormat,
  internalEan13,
  normaliseBarcode,
  packagePrice,
  PackagingError,
  type BarcodeFormat,
  type PackagingInput,
  type PackagingLevel,
  type ProductBarcode,
} from "@/lib/erp/packaging";
import {
  assertCan,
  assertOutletAccess,
  DomainError,
  daysToExpiry,
  isBatchBlocked,
  isExpired,
  outletName,
  productPackaging,
  recordAudit,
  refreshProductStatus,
  scopeByOutlet,
  sellableQuantity,
} from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import { REGISTRATION_STATUSES, type Actor, type PriceChange, type ProductCatalogLists, type RegistrationStatus } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";

const NAFDAC_PATTERN = /^[A-Z0-9]{2}-\d{4,6}$/;
const LIFECYCLES = ["ACTIVE", "INACTIVE", "DISCONTINUED"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export function catalogLists(): ProductCatalogLists {
  return getStore().settings.catalog;
}

function wrapPackaging<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof PackagingError) throw new DomainError(error.message);
    throw error;
  }
}

export function normaliseNafdac(value: string | undefined) {
  const trimmed = (value ?? "").trim().toUpperCase();
  if (!trimmed || trimmed === "PENDING") return "Pending";
  if (!NAFDAC_PATTERN.test(trimmed)) throw new DomainError("NAFDAC number must look like A4-12345, or be left blank while pending.");
  return trimmed;
}

// ---------------------------------------------------------------- barcodes

/** Barcode owner, if any. Barcodes are shared by the same item at every outlet but never by two different items. */
function barcodeOwner(code: string) {
  return products.find((product) => product.barcode === code || product.barcodes?.some((row) => row.code === code));
}

function assertBarcodeFree(code: string, productName: string) {
  const owner = barcodeOwner(code);
  if (owner && owner.name.toLowerCase() !== productName.toLowerCase()) throw new DomainError(`Barcode ${code} is already used by ${owner.name}.`);
}

function nextInternalBarcode() {
  for (;;) {
    const code = internalEan13(1_000_000 + nextNumber("barcode"));
    if (!barcodeOwner(code)) return code;
  }
}

export type BarcodeInput = { code?: string; format?: BarcodeFormat; source: "MANUFACTURER" | "INTERNAL"; packagingId?: string };

function prepareBarcode(input: BarcodeInput, productName: string, levels: PackagingLevel[]): ProductBarcode {
  const level = input.packagingId ? levels.find((row) => row.id === input.packagingId) : baseLevel(levels);
  if (!level) throw new DomainError("Choose the packaging level this barcode is printed on.");
  if (input.source === "INTERNAL") {
    const code = nextInternalBarcode();
    return { code, format: "EAN13", source: "INTERNAL", packagingId: level.isBase ? undefined : level.id };
  }
  const code = normaliseBarcode(input.code ?? "");
  if (!code) throw new DomainError("Enter or scan the manufacturer barcode.");
  const format = input.format ?? detectBarcodeFormat(code);
  const problem = barcodeError(code, format);
  if (problem) throw new DomainError(problem);
  assertBarcodeFree(code, productName);
  return { code, format, source: "MANUFACTURER", packagingId: level.isBase ? undefined : level.id };
}

/** Product and packaging level for a scanned code at one outlet (POS and goods receipt). */
export function lookupBarcode(actor: Actor, rawCode: string, outletId: string | null) {
  const code = normaliseBarcode(rawCode);
  if (!code) throw new DomainError("Scan or type a barcode.");
  const scope = outletId ?? actor.outletId;
  if (scope) assertOutletAccess(actor, scope);
  const matches = products.filter((product) => (!scope || product.outletId === scope) && (product.barcode === code || product.barcodes?.some((row) => row.code === code)));
  if (matches.length === 0) throw new DomainError(`No item with barcode ${code}${scope ? ` at ${outletName(scope)}` : ""}.`, 404);
  return matches.map((product) => {
    const levels = productPackaging(product);
    const tagged = product.barcodes?.find((row) => row.code === code);
    const level = (tagged?.packagingId && levels.find((row) => row.id === tagged.packagingId)) || baseLevel(levels);
    return {
      productId: product.id,
      name: product.name,
      outletId: product.outletId,
      packagingId: level.id,
      packaging: level.name,
      unitsPerPackage: level.unitsPerPackage,
      price: packagePrice(level, product, "sellingPrice") ?? product.sellingPrice * level.unitsPerPackage,
      cost: packagePrice(level, product, "purchasePrice") ?? product.purchasePrice * level.unitsPerPackage,
      lifecycle: product.lifecycle ?? "ACTIVE",
      restricted: product.status === "RESTRICTED",
    };
  });
}

export function addBarcode(actor: Actor, productId: string, input: BarcodeInput) {
  assertCan(actor, "products.manage");
  const product = findProduct(actor, productId);
  const barcode = prepareBarcode(input, product.name, productPackaging(product));
  // The same item at every outlet carries the same barcodes, so scanning works network-wide.
  const siblings = products.filter((row) => row.name === product.name && (!isOutletScoped(actor.role) || row.id === product.id));
  for (const row of siblings) {
    row.barcodes = [...(row.barcodes ?? []).filter((existing) => existing.code !== barcode.code), barcode];
    if (!row.barcode) row.barcode = barcode.code;
  }
  recordAudit(actor, { action: "products.barcode", entity: "Product", entityId: product.id, summary: `${product.name}: barcode ${barcode.code} (${barcode.format}, ${barcode.source.toLowerCase()}) added`, outletId: product.outletId });
  return barcode;
}

export function removeBarcode(actor: Actor, productId: string, code: string) {
  assertCan(actor, "products.manage");
  const product = findProduct(actor, productId);
  if (!product.barcodes?.some((row) => row.code === code) && product.barcode !== code) throw new DomainError("Barcode not found on this item.", 404);
  for (const row of products.filter((item) => item.name === product.name && (!isOutletScoped(actor.role) || item.id === product.id))) {
    row.barcodes = (row.barcodes ?? []).filter((existing) => existing.code !== code);
    if (row.barcode === code) row.barcode = row.barcodes[0]?.code ?? "";
  }
  recordAudit(actor, { action: "products.barcode", entity: "Product", entityId: product.id, summary: `${product.name}: barcode ${code} removed`, outletId: product.outletId, severity: "warning" });
  return { removed: code };
}

// ---------------------------------------------------------------- price history

const PRICE_FIELDS = [
  ["purchasePrice", "purchase"],
  ["sellingPrice", "selling"],
  ["wholesalePrice", "wholesale"],
  ["minSellingPrice", "minimum"],
] as const;

function recordPrice(actor: Actor, product: Product, level: string, kind: PriceChange["kind"], oldValue: number | undefined, newValue: number | undefined) {
  if ((oldValue ?? null) === (newValue ?? null)) return;
  getStore().priceHistory.unshift({
    id: `prc-${nextNumber("price")}`,
    at: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    outletId: product.outletId,
    level,
    kind,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    userId: actor.id,
    userName: actor.name,
  });
}

/** Records every base-unit and packaging-level price that differs between two versions of an item. */
export function recordPriceChanges(actor: Actor, product: Product, before: { prices: Partial<Record<(typeof PRICE_FIELDS)[number][0], number>>; packaging: PackagingLevel[] } | null) {
  const unit = baseUnitName(product);
  for (const [field, kind] of PRICE_FIELDS) recordPrice(actor, product, `per ${unit}`, kind, before?.prices[field], product[field]);
  for (const level of product.packaging ?? []) {
    if (level.isBase) continue;
    const previous = before?.packaging.find((row) => row.id === level.id);
    for (const [field, kind] of PRICE_FIELDS) recordPrice(actor, product, level.name, kind, previous?.[field], level[field]);
  }
}

function priceSnapshot(product: Product) {
  return {
    prices: { purchasePrice: product.purchasePrice, sellingPrice: product.sellingPrice, wholesalePrice: product.wholesalePrice, minSellingPrice: product.minSellingPrice },
    packaging: structuredClone(product.packaging ?? []),
  };
}

// ---------------------------------------------------------------- pricing rules

export type BasePricing = { purchasePrice?: number | null; sellingPrice?: number | null; wholesalePrice?: number | null; minSellingPrice?: number | null };

/** Base-unit prices, derived from a package price when only that was entered (e.g. carton cost ÷ 1,000). */
function resolvePricing(levels: PackagingLevel[], input: BasePricing) {
  const derive = (field: "purchasePrice" | "sellingPrice" | "wholesalePrice" | "minSellingPrice") => {
    const direct = input[field];
    if (typeof direct === "number" && direct > 0) return Math.round(direct * 10000) / 10000;
    const priced = levels.find((level) => (level[field] ?? 0) > 0);
    return priced ? Math.round(((priced[field] as number) / priced.unitsPerPackage) * 10000) / 10000 : undefined;
  };
  const pricing = { purchasePrice: derive("purchasePrice"), sellingPrice: derive("sellingPrice"), wholesalePrice: derive("wholesalePrice"), minSellingPrice: derive("minSellingPrice") };
  if (!pricing.purchasePrice) throw new DomainError("Enter a purchase price (per base unit or for a package).");
  if (!pricing.sellingPrice) throw new DomainError("Enter a selling price (per base unit or for a package).");
  for (const level of levels) {
    const base = { purchasePrice: pricing.purchasePrice, sellingPrice: pricing.sellingPrice, wholesalePrice: pricing.wholesalePrice, minSellingPrice: pricing.minSellingPrice };
    const cost = packagePrice(level, base, "purchasePrice") ?? 0;
    const sell = packagePrice(level, base, "sellingPrice") ?? 0;
    const minimum = packagePrice(level, base, "minSellingPrice");
    const wholesale = packagePrice(level, base, "wholesalePrice");
    if (sell < cost - 0.005) throw new DomainError(`${level.name}: selling price (₦${sell.toLocaleString()}) cannot be below cost (₦${cost.toLocaleString()}).`);
    if (minimum !== undefined && minimum > sell + 0.005) throw new DomainError(`${level.name}: minimum selling price cannot be above the selling price.`);
    if (minimum !== undefined && minimum < cost - 0.005) throw new DomainError(`${level.name}: minimum selling price cannot be below cost.`);
    if (wholesale !== undefined && wholesale < cost - 0.005) throw new DomainError(`${level.name}: wholesale price cannot be below cost.`);
  }
  return pricing as { purchasePrice: number; sellingPrice: number; wholesalePrice?: number; minSellingPrice?: number };
}

// ---------------------------------------------------------------- registration

export type OpeningBatchInput = {
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  receivingDate?: string;
  supplierId?: string;
  supplierBatchRef?: string;
  regulatoryNumber?: string;
  /** Quantity in the packaging level below (index into the packaging list), or base units when omitted. */
  packagingIndex?: number;
  quantity: number;
  /** Cost per package of that level; defaults to the configured purchase price. */
  unitCost?: number;
};

export type RegistrationInput = {
  name: string;
  /** Product code / SKU. Generated when blank. */
  sku?: string;
  genericName?: string;
  category: string;
  productType?: string;
  dosageForm?: string;
  strength?: string;
  size?: string;
  manufacturer?: string;
  supplierId?: string;
  description?: string;
  outletId: string;
  lifecycle?: Lifecycle;
  rxOnly?: boolean;
  controlled?: boolean;
  minStock?: number;
  maxStock?: number;
  packaging: PackagingInput[];
  pricing: BasePricing;
  barcodeMode: "none" | "manufacturer" | "internal";
  /** Manufacturer barcodes (mode "manufacturer") or packaging levels to generate internal codes for (mode "internal"). */
  barcodes?: { code?: string; format?: BarcodeFormat; packagingIndex?: number }[];
  regulatory?: {
    nafdacNumber?: string;
    status?: RegistrationStatus;
    approvalDate?: string;
    renewalDate?: string;
    expiryDate?: string;
    localRepresentative?: string;
    notes?: string;
  };
  openingStock?: OpeningBatchInput[];
};

export function registerProduct(actor: Actor, input: RegistrationInput) {
  assertCan(actor, "products.manage");
  assertOutletAccess(actor, input.outletId);
  const outlet = outlets.find((row) => row.id === input.outletId);
  if (!outlet) throw new DomainError("Choose the outlet this item is stocked at.");
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError("Product name is required.");
  if (products.some((product) => product.outletId === input.outletId && product.name.toLowerCase() === name.toLowerCase())) {
    throw new DomainError(`${name} is already registered at ${outlet.name}.`);
  }
  const sku = (input.sku?.trim().toUpperCase() || `SKU-${String(10000 + nextNumber("sku"))}`).replace(/\s+/g, "-");
  if (!/^[A-Z0-9][A-Z0-9-/.]{1,31}$/.test(sku)) throw new DomainError("Product code may use letters, numbers, dashes, dots and slashes (2–32 characters).");
  const skuOwner = products.find((product) => product.sku === sku);
  if (skuOwner && skuOwner.name.toLowerCase() !== name.toLowerCase()) throw new DomainError(`Product code ${sku} is already used by ${skuOwner.name}.`);
  const catalog = catalogLists();
  if (!catalog.categories.includes(input.category)) throw new DomainError("Choose a category from the list.");
  if (input.dosageForm && !catalog.dosageForms.includes(input.dosageForm)) throw new DomainError("Choose a dosage form from the list.");
  if (input.productType && !catalog.productTypes.includes(input.productType)) throw new DomainError("Choose a product type from the list.");
  const lifecycle = input.lifecycle ?? "ACTIVE";
  if (!LIFECYCLES.includes(lifecycle)) throw new DomainError("Unknown product status.");
  if (input.controlled && !input.rxOnly) throw new DomainError("Controlled drugs must also be prescription-only.");
  if (input.supplierId && !getStore().suppliers.some((row) => row.id === input.supplierId)) throw new DomainError("Unknown supplier.");
  const minStock = Math.max(0, Math.floor(input.minStock ?? 0));
  if (input.maxStock !== undefined && input.maxStock > 0 && input.maxStock < minStock) throw new DomainError("Maximum stock cannot be below the reorder level.");

  const productId = `prod-${Date.now().toString(36)}${nextNumber("product")}`;
  const packaging = wrapPackaging(() => buildPackaging(input.packaging, (index) => `${productId}-pk${index}`));
  if (!packaging.some((level) => level.sellable)) throw new DomainError("At least one packaging level must be sellable.");
  const pricing = resolvePricing(packaging, input.pricing);
  const base = baseLevel(packaging);

  // Barcodes.
  const barcodes: ProductBarcode[] = [];
  if (input.barcodeMode !== "none") {
    const requested = input.barcodes?.length ? input.barcodes : [{ packagingIndex: packaging.length - 1 }];
    for (const row of requested) {
      const level = packaging[row.packagingIndex ?? packaging.length - 1];
      if (!level) throw new DomainError("A barcode refers to a packaging level that does not exist.");
      const barcode = prepareBarcode({ code: row.code, format: row.format, source: input.barcodeMode === "internal" ? "INTERNAL" : "MANUFACTURER", packagingId: level.id }, name, packaging);
      if (barcodes.some((existing) => existing.code === barcode.code)) throw new DomainError(`Barcode ${barcode.code} is entered twice.`);
      barcodes.push(barcode);
    }
  }

  // Regulatory.
  const regulatory = input.regulatory ?? {};
  const nafdacNumber = normaliseNafdac(regulatory.nafdacNumber);
  if (regulatory.status && !REGISTRATION_STATUSES.includes(regulatory.status)) throw new DomainError("Unknown regulatory status.");
  if (regulatory.approvalDate && regulatory.expiryDate && Date.parse(regulatory.expiryDate) <= Date.parse(regulatory.approvalDate)) {
    throw new DomainError("Registration expiry must be after the approval date.");
  }

  // Opening stock needs both item-master and stock-approval rights.
  const opening = (input.openingStock ?? []).filter((row) => row.quantity > 0 || row.batchNumber.trim());
  if (opening.length && !(can(actor, "products.manage") && can(actor, "stock.approve"))) {
    throw new DomainError("Entering opening stock needs the \"Approve stock movements\" permission as well.", 403);
  }
  const seenBatches = new Set<string>();
  const preparedOpening = opening.map((row, index) => {
    const label = `Opening batch ${index + 1}`;
    const batchNumber = row.batchNumber.trim().toUpperCase();
    if (!batchNumber) throw new DomainError(`${label}: batch number is required.`);
    if (seenBatches.has(batchNumber)) throw new DomainError(`Batch ${batchNumber} is entered twice.`);
    seenBatches.add(batchNumber);
    const level = packaging[row.packagingIndex ?? packaging.length - 1];
    if (!level) throw new DomainError(`${label}: unknown packaging level.`);
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) throw new DomainError(`${label}: quantity must be a positive whole number.`);
    const expiry = Date.parse(row.expiryDate);
    if (Number.isNaN(expiry)) throw new DomainError(`${label}: expiry date is required.`);
    if (expiry <= Date.now()) throw new DomainError(`${label}: batch ${batchNumber} has already expired; expired stock cannot be taken on as saleable stock.`);
    if (row.manufacturingDate) {
      const made = Date.parse(row.manufacturingDate);
      if (Number.isNaN(made) || made > Date.now()) throw new DomainError(`${label}: manufacturing date cannot be in the future.`);
      if (made >= expiry) throw new DomainError(`${label}: expiry must be after the manufacturing date.`);
    }
    const supplier = row.supplierId ? getStore().suppliers.find((supplierRow) => supplierRow.id === row.supplierId) : undefined;
    if (row.supplierId && !supplier) throw new DomainError(`${label}: unknown supplier.`);
    const packageCost = row.unitCost && row.unitCost > 0 ? row.unitCost : packagePrice(level, pricing, "purchasePrice") ?? pricing.purchasePrice * level.unitsPerPackage;
    return { row, batchNumber, level, supplier, baseQuantity: row.quantity * level.unitsPerPackage, unitCost: Math.round((packageCost / level.unitsPerPackage) * 10000) / 10000 };
  });

  const primary = barcodes.find((row) => !row.packagingId) ?? barcodes[0];
  const product: Product = {
    id: productId,
    name,
    sku,
    genericName: input.genericName?.trim() || name,
    category: input.category,
    productType: input.productType || undefined,
    dosageForm: input.dosageForm || undefined,
    manufacturer: input.manufacturer?.trim() || "-",
    strength: input.strength?.trim() || "-",
    size: input.size?.trim() || undefined,
    description: input.description?.trim() || undefined,
    supplierId: input.supplierId || undefined,
    uom: base.name,
    baseUnit: base.name,
    purchasePrice: pricing.purchasePrice,
    sellingPrice: pricing.sellingPrice,
    wholesalePrice: pricing.wholesalePrice,
    minSellingPrice: pricing.minSellingPrice,
    minStock,
    maxStock: input.maxStock && input.maxStock > 0 ? Math.floor(input.maxStock) : undefined,
    stock: 0,
    status: "LOW_STOCK",
    lifecycle,
    barcode: primary?.code ?? "",
    barcodes,
    packaging,
    nafdacNumber,
    outletId: input.outletId,
    expiryWindow: "-",
    rxOnly: Boolean(input.rxOnly),
    controlled: Boolean(input.controlled),
  };
  refreshProductStatus(product);
  products.unshift(product);
  recordPriceChanges(actor, product, null);

  // Regulatory register (one record per product name, shared by all outlets).
  const store = getStore();
  const existing = store.registrations.find((row) => row.productName.toLowerCase() === name.toLowerCase());
  if (!existing) {
    store.registrations.push({
      id: `reg-${Date.now().toString(36)}-${nextNumber("registration")}`,
      productName: name,
      genericName: product.genericName,
      manufacturer: product.manufacturer,
      category: input.productType?.startsWith("Supplement") ? "Supplement" : input.productType?.startsWith("Cosmetic") ? "Cosmetic" : input.productType?.startsWith("Medical device") ? "Medical device" : "Drug",
      nafdacNumber,
      issuedDate: regulatory.approvalDate ?? "",
      expiryDate: regulatory.expiryDate ?? "",
      renewalDate: regulatory.renewalDate || undefined,
      localRepresentative: regulatory.localRepresentative?.trim() || undefined,
      status: regulatory.status ?? (nafdacNumber === "Pending" ? "Pending" : "Registered"),
      notes: regulatory.notes?.trim() || undefined,
      updatedBy: actor.name,
      updatedAt: new Date().toISOString(),
    });
  } else if (nafdacNumber === "Pending") {
    // The item takes the number already on the national register.
    product.nafdacNumber = existing.nafdacNumber;
  }

  // Opening balances, each its own batch and ledger row.
  const reference = `OPEN-${String(nextNumber("opening")).padStart(5, "0")}`;
  for (const prepared of preparedOpening) {
    receiveIntoNewBatch(
      actor,
      product,
      {
        batchNumber: prepared.batchNumber,
        manufacturingDate: prepared.row.manufacturingDate || "",
        expiryDate: prepared.row.expiryDate,
        receivingDate: prepared.row.receivingDate || new Date().toISOString().slice(0, 10),
        supplier: prepared.supplier?.name ?? "Opening stock",
        supplierId: prepared.supplier?.id,
        supplierBatchRef: prepared.row.supplierBatchRef?.trim(),
        regulatoryNumber: prepared.row.regulatoryNumber?.trim().toUpperCase() || (nafdacNumber !== "Pending" ? nafdacNumber : undefined),
        unitCost: prepared.unitCost,
      },
      { type: "OPENING", baseQuantity: prepared.baseQuantity, reference, remarks: "Opening stock at registration", unit: { name: prepared.level.name, unitsPerPackage: prepared.level.unitsPerPackage } },
    );
  }

  recordAudit(actor, {
    action: "products.create",
    entity: "Product",
    entityId: product.id,
    summary: `Registered ${product.name} at ${outlet.name} · ${packaging.map((level) => level.name).join(" › ")} · price ₦${pricing.sellingPrice.toLocaleString()}/${base.name}${barcodes.length ? ` · ${barcodes.length} barcode(s)` : ""}${preparedOpening.length ? ` · opening stock ${preparedOpening.reduce((sum, row) => sum + row.baseQuantity, 0).toLocaleString()} ${base.name}(s) in ${preparedOpening.length} batch(es) (${reference})` : ""}${nafdacNumber === "Pending" ? " · NAFDAC no. pending" : ""}`,
    outletId: product.outletId,
    severity: preparedOpening.length || nafdacNumber === "Pending" ? "warning" : "info",
  });
  return product;
}

// ---------------------------------------------------------------- updates

export type ProductUpdate = {
  genericName?: string;
  category?: string;
  productType?: string;
  dosageForm?: string;
  strength?: string;
  size?: string;
  manufacturer?: string;
  supplierId?: string;
  description?: string;
  lifecycle?: Lifecycle;
  pricing?: BasePricing;
  /** Prices per packaging level, keyed by level id. */
  levelPrices?: Record<string, { purchasePrice?: number | null; sellingPrice?: number | null; wholesalePrice?: number | null; minSellingPrice?: number | null; sellable?: boolean }>;
  /** Replace the packaging structure (only before the item has any stock history). */
  packaging?: PackagingInput[];
};

export function updateProductMaster(actor: Actor, productId: string, input: ProductUpdate) {
  assertCan(actor, "products.manage");
  const product = findProduct(actor, productId);
  const catalog = catalogLists();
  const before = priceSnapshot(product);
  const changes: string[] = [];

  if (input.category !== undefined && input.category !== product.category) {
    if (!catalog.categories.includes(input.category)) throw new DomainError("Choose a category from the list.");
    changes.push(`category → ${input.category}`);
    product.category = input.category;
  }
  if (input.dosageForm !== undefined && input.dosageForm !== (product.dosageForm ?? "")) {
    if (input.dosageForm && !catalog.dosageForms.includes(input.dosageForm)) throw new DomainError("Choose a dosage form from the list.");
    product.dosageForm = input.dosageForm || undefined;
    changes.push(`dosage form → ${input.dosageForm || "—"}`);
  }
  if (input.productType !== undefined && input.productType !== (product.productType ?? "")) {
    if (input.productType && !catalog.productTypes.includes(input.productType)) throw new DomainError("Choose a product type from the list.");
    product.productType = input.productType || undefined;
    changes.push(`type → ${input.productType || "—"}`);
  }
  if (input.supplierId !== undefined && input.supplierId !== (product.supplierId ?? "")) {
    if (input.supplierId && !getStore().suppliers.some((row) => row.id === input.supplierId)) throw new DomainError("Unknown supplier.");
    product.supplierId = input.supplierId || undefined;
    changes.push("preferred supplier changed");
  }
  for (const field of ["genericName", "strength", "size", "manufacturer", "description"] as const) {
    const value = input[field];
    if (value === undefined || value.trim() === (product[field] ?? "")) continue;
    (product as Record<string, unknown>)[field] = value.trim() || (field === "genericName" ? product.name : undefined);
    changes.push(`${field} updated`);
  }
  if (input.lifecycle !== undefined && input.lifecycle !== (product.lifecycle ?? "ACTIVE")) {
    if (!LIFECYCLES.includes(input.lifecycle)) throw new DomainError("Unknown product status.");
    changes.push(`status ${(product.lifecycle ?? "ACTIVE").toLowerCase()} → ${input.lifecycle.toLowerCase()}`);
    product.lifecycle = input.lifecycle;
  }

  if (input.packaging) {
    if (ledgerFor({ productId: product.id }).length > 0) {
      throw new DomainError("Packaging conversions cannot change once the item has stock history. Register a new item for a new pack format.");
    }
    product.packaging = wrapPackaging(() => buildPackaging(input.packaging!, (index) => `${product.id}-pk${Date.now().toString(36)}${index}`));
    product.baseUnit = baseLevel(product.packaging).name;
    product.uom = product.baseUnit;
    changes.push(`packaging → ${product.packaging.map((level) => `${level.name}(${level.unitsPerPackage})`).join(" › ")}`);
  }

  const pricesTouched =
    Boolean(input.pricing) ||
    Object.values(input.levelPrices ?? {}).some((row) => (["purchasePrice", "sellingPrice", "wholesalePrice", "minSellingPrice"] as const).some((field) => row[field] !== undefined));
  if (pricesTouched) assertCan(actor, "products.price");
  if (input.pricing || input.levelPrices) {
    const levels = structuredClone(productPackaging(product));
    for (const level of levels) {
      const update = input.levelPrices?.[level.id];
      if (!update) continue;
      for (const field of ["purchasePrice", "sellingPrice", "wholesalePrice", "minSellingPrice"] as const) {
        if (update[field] === undefined) continue;
        level[field] = update[field] && update[field]! > 0 ? update[field]! : undefined;
      }
      if (update.sellable !== undefined) level.sellable = update.sellable;
    }
    if (!levels.some((level) => level.sellable)) throw new DomainError("At least one packaging level must be sellable.");
    const pricing = resolvePricing(levels, {
      purchasePrice: input.pricing?.purchasePrice ?? product.purchasePrice,
      sellingPrice: input.pricing?.sellingPrice ?? product.sellingPrice,
      wholesalePrice: input.pricing?.wholesalePrice !== undefined ? input.pricing.wholesalePrice : product.wholesalePrice,
      minSellingPrice: input.pricing?.minSellingPrice !== undefined ? input.pricing.minSellingPrice : product.minSellingPrice,
    });
    Object.assign(product, pricing);
    product.packaging = levels;
  }
  const historyBefore = getStore().priceHistory.length;
  recordPriceChanges(actor, product, before);
  const priceChanges = getStore().priceHistory.length - historyBefore;
  if (priceChanges) changes.push(`${priceChanges} price change(s)`);

  refreshProductStatus(product);
  recordAudit(actor, {
    action: "products.update",
    entity: "Product",
    entityId: product.id,
    summary: `${product.name} @ ${outletName(product.outletId)}: ${changes.join(", ") || "no changes"}`,
    outletId: product.outletId,
    severity: changes.some((change) => change.includes("price") || change.includes("discontinued")) ? "warning" : "info",
  });
  return product;
}

// ---------------------------------------------------------------- catalogue lists

export function updateCatalog(actor: Actor, input: Partial<ProductCatalogLists>) {
  assertCan(actor, "catalog.manage");
  const settings = getStore().settings;
  const next: ProductCatalogLists = { ...settings.catalog };
  const changes: string[] = [];
  const inUse: Record<keyof ProductCatalogLists, (value: string) => boolean> = {
    categories: (value) => products.some((product) => product.category === value),
    dosageForms: (value) => products.some((product) => product.dosageForm === value),
    productTypes: (value) => products.some((product) => product.productType === value),
    packagingTypes: () => false,
  };
  for (const key of ["categories", "dosageForms", "productTypes", "packagingTypes"] as const) {
    const list = input[key];
    if (!list) continue;
    const cleaned = Array.from(new Set(list.map((value) => value.trim()).filter(Boolean)));
    if (cleaned.length === 0) throw new DomainError("Each list needs at least one entry.");
    if (cleaned.some((value) => value.length > 60)) throw new DomainError("List entries must be 60 characters or fewer.");
    const removed = settings.catalog[key].filter((value) => !cleaned.includes(value));
    const blocked = removed.find(inUse[key]);
    if (blocked) throw new DomainError(`"${blocked}" is still used by registered items and cannot be removed.`);
    const added = cleaned.filter((value) => !settings.catalog[key].includes(value));
    if (added.length || removed.length) changes.push(`${key}: ${[...added.map((value) => `+${value}`), ...removed.map((value) => `−${value}`)].join(", ")}`);
    next[key] = cleaned;
  }
  settings.catalog = next;
  recordAudit(actor, { action: "catalog.update", entity: "Settings", entityId: "catalog", summary: changes.join("; ") || "No changes", severity: changes.length ? "warning" : "info" });
  return next;
}

// ---------------------------------------------------------------- read models

function findProduct(actor: Actor, productId: string) {
  const product = products.find((row) => row.id === productId);
  if (!product) throw new DomainError("Item not found.", 404);
  if (isOutletScoped(actor.role)) assertOutletAccess(actor, product.outletId);
  return product;
}

export function productDetail(actor: Actor, productId: string) {
  const product = findProduct(actor, productId);
  const levels = productPackaging(product);
  const store = getStore();
  const productBatches = batches
    .filter((batch) => batch.productId === product.id)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const ledger = ledgerFor({ productId: product.id });
  const now = Date.now();
  const nearExpiryDays = store.settings.nearExpiryDays;
  return {
    product: {
      ...product,
      packaging: levels,
      barcodes: product.barcodes ?? (product.barcode ? [{ code: product.barcode, format: detectBarcodeFormat(product.barcode), source: "MANUFACTURER" as const }] : []),
      supplierName: store.suppliers.find((row) => row.id === product.supplierId)?.name,
      outletName: outletName(product.outletId),
      baseUnit: baseUnitName(product),
    },
    prices: levels.map((level) => ({
      id: level.id,
      name: level.name,
      unitsPerPackage: level.unitsPerPackage,
      sellable: level.sellable,
      purchasePrice: packagePrice(level, product, "purchasePrice"),
      sellingPrice: packagePrice(level, product, "sellingPrice"),
      wholesalePrice: packagePrice(level, product, "wholesalePrice"),
      minSellingPrice: packagePrice(level, product, "minSellingPrice"),
      custom: Boolean(level.sellingPrice && !level.isBase),
    })),
    summary: summarise(ledger, productBatches),
    batches: productBatches.map((batch) => {
      const days = daysToExpiry(batch, now);
      const blocked = isBatchBlocked(batch, now);
      return {
        ...batch,
        days,
        value: batch.availableQuantity * batch.purchasePrice,
        state: batch.availableQuantity === 0 ? "Depleted" : isExpired(batch, now) ? "Expired" : blocked ? "Quarantined" : days <= nearExpiryDays ? "Near expiry" : "Healthy",
        pendingMovement: stockMovements.some((movement) => movement.batchId === batch.id && movement.status === "Pending"),
      };
    }),
    ledger: ledger.slice(0, 500),
    priceHistory: store.priceHistory.filter((row) => row.productId === product.id).slice(0, 200),
    registration: store.registrations.find((row) => row.productName === product.name) ?? null,
    documents: store.documents.filter((document) => document.relatedTo === product.name).map((document) => ({ id: document.id, title: document.title, category: document.category, expiresOn: document.expiresOn, uploadedAt: document.uploadedAt })),
    otherOutlets: products
      .filter((row) => row.name === product.name && row.id !== product.id && (!isOutletScoped(actor.role) || actor.outletIds.includes(row.outletId)))
      .map((row) => ({ id: row.id, outletId: row.outletId, outletName: outletName(row.outletId), stock: row.stock })),
    nearExpiryDays,
  };
}

/** One row per item and outlet for the inventory list: balances, expiry indicators and valuation. */
export function inventoryRows(actor: Actor) {
  const { nearExpiryDays } = getStore().settings;
  const now = Date.now();
  return scopeByOutlet(actor, products, (product) => product.outletId).map((product) => {
    const held = batches.filter((batch) => batch.productId === product.id && batch.availableQuantity > 0);
    const expired = held.filter((batch) => isExpired(batch, now));
    const near = held.filter((batch) => !isExpired(batch, now) && daysToExpiry(batch, now) <= nearExpiryDays);
    const quarantined = held.filter((batch) => !isExpired(batch, now) && isBatchBlocked(batch, now));
    const nextExpiry = held.filter((batch) => !isBatchBlocked(batch, now)).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0];
    const levels = productPackaging(product);
    return {
      id: product.id,
      name: product.name,
      sku: product.sku ?? "",
      genericName: product.genericName,
      category: product.category,
      dosageForm: product.dosageForm ?? "",
      manufacturer: product.manufacturer,
      strength: product.strength,
      uom: product.baseUnit || product.uom,
      purchasePrice: product.purchasePrice,
      sellingPrice: product.sellingPrice,
      minStock: product.minStock,
      stock: product.stock,
      breakdown: levels.length > 1 ? describeBreakdown(product.stock, levels) : "",
      sellable: sellableQuantity(product.id, product.outletId),
      value: held.reduce((sum, batch) => sum + batch.availableQuantity * batch.purchasePrice, 0),
      status: product.status,
      lifecycle: product.lifecycle ?? "ACTIVE",
      barcode: [product.barcode, ...(product.barcodes ?? []).map((row) => row.code)].filter(Boolean).join(" "),
      batchNumbers: held.map((batch) => batch.batchNumber),
      expiredQty: expired.reduce((sum, batch) => sum + batch.availableQuantity, 0),
      nearQty: near.reduce((sum, batch) => sum + batch.availableQuantity, 0),
      quarantinedQty: quarantined.reduce((sum, batch) => sum + batch.availableQuantity, 0),
      nextExpiry: nextExpiry?.expiryDate ?? "",
      expiryState: expired.length ? "expired" : near.length ? "near" : held.length ? "ok" : "none",
      nafdacNumber: product.nafdacNumber,
      outletId: product.outletId,
      rxOnly: Boolean(product.rxOnly),
      controlled: Boolean(product.controlled),
      locations: products.filter((other) => other.name === product.name).length,
    };
  });

}
