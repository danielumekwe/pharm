// Packaging conversions, unit pricing and barcode rules. Pure module (no app imports) so it can run on
// the client, the server and directly under `node --test`.

export type PackagingLevel = {
  id: string;
  /** e.g. "Carton", "Pack", "Strip", "Tablet". */
  name: string;
  /** How many of the next-smaller level one of these holds (1 for the base unit). */
  contains: number;
  /** Base units in one of this package (calculated). */
  unitsPerPackage: number;
  isBase: boolean;
  /** Per-package prices. Blank prices are derived from the base-unit price. */
  purchasePrice?: number;
  sellingPrice?: number;
  wholesalePrice?: number;
  minSellingPrice?: number;
  /** Whether this package can be sold at POS. */
  sellable: boolean;
};

export type BarcodeFormat = "EAN13" | "UPCA" | "CODE128";
export type BarcodeSource = "MANUFACTURER" | "INTERNAL";

export type ProductBarcode = {
  code: string;
  format: BarcodeFormat;
  source: BarcodeSource;
  /** Packaging level this barcode identifies (e.g. the carton). Empty means the base unit. */
  packagingId?: string;
};

export type PackagingInput = {
  id?: string;
  name: string;
  contains: number;
  purchasePrice?: number | null;
  sellingPrice?: number | null;
  wholesalePrice?: number | null;
  minSellingPrice?: number | null;
  sellable?: boolean;
};

export class PackagingError extends Error {}

const round2 = (value: number) => Math.round(value * 100) / 100;
const positive = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);

/**
 * Builds packaging levels from largest to smallest. Each level holds `contains` of the next one; the last
 * level is the base unit (contains 1). Example: Carton 10 → Pack 10 → Strip 10 → Tablet gives 1 carton = 1,000 tablets.
 */
export function buildPackaging(levels: PackagingInput[], makeId: (index: number) => string = (index) => `pkg-${index}`): PackagingLevel[] {
  if (levels.length === 0) throw new PackagingError("Add at least the base unit (e.g. Tablet, Bottle, Piece).");
  if (levels.length > 6) throw new PackagingError("Use at most 6 packaging levels.");
  const names = new Set<string>();
  for (const level of levels) {
    const name = level.name.trim();
    if (!name) throw new PackagingError("Every packaging level needs a name.");
    if (names.has(name.toLowerCase())) throw new PackagingError(`Packaging level "${name}" is listed twice.`);
    names.add(name.toLowerCase());
  }
  const result: PackagingLevel[] = new Array(levels.length);
  let units = 1;
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const level = levels[index];
    const isBase = index === levels.length - 1;
    const contains = isBase ? 1 : Number(level.contains);
    if (!isBase && (!Number.isInteger(contains) || contains < 2)) {
      throw new PackagingError(`1 ${level.name.trim()} must contain a whole number (2 or more) of ${levels[index + 1].name.trim()}.`);
    }
    units *= contains;
    if (units > 10_000_000) throw new PackagingError("Packaging conversion is unrealistically large.");
    result[index] = {
      id: level.id || makeId(index),
      name: level.name.trim(),
      contains,
      unitsPerPackage: units,
      isBase,
      purchasePrice: positive(level.purchasePrice),
      sellingPrice: positive(level.sellingPrice),
      wholesalePrice: positive(level.wholesalePrice),
      minSellingPrice: positive(level.minSellingPrice),
      sellable: level.sellable ?? true,
    };
  }
  return result;
}

/** Default single level for items registered before packaging existed: their unit of measure is the base unit. */
export function defaultPackaging(unit: string, prices: { purchasePrice: number; sellingPrice: number }): PackagingLevel[] {
  return [{ id: "pkg-base", name: unit || "Unit", contains: 1, unitsPerPackage: 1, isBase: true, purchasePrice: prices.purchasePrice, sellingPrice: prices.sellingPrice, sellable: true }];
}

export function baseLevel(levels: PackagingLevel[]) {
  return levels.find((level) => level.isBase) ?? levels[levels.length - 1];
}

/** Converts a quantity of a package into base units. */
export function toBaseUnits(quantity: number, level: Pick<PackagingLevel, "unitsPerPackage">) {
  return quantity * level.unitsPerPackage;
}

type PriceKind = "purchasePrice" | "sellingPrice" | "wholesalePrice" | "minSellingPrice";

/** Price of one package: its own price when set, otherwise the base-unit price × units in the package. */
export function packagePrice(level: PackagingLevel, base: { purchasePrice: number; sellingPrice: number; wholesalePrice?: number; minSellingPrice?: number }, kind: PriceKind) {
  const own = level[kind];
  if (own !== undefined && own > 0) return own;
  const unit = base[kind];
  return unit !== undefined && unit > 0 ? round2(unit * level.unitsPerPackage) : undefined;
}

/** Expresses base units as whole packages, e.g. 1,234 tablets → 1 Carton, 2 Packs, 3 Strips, 4 Tablets. */
export function breakdown(baseQuantity: number, levels: PackagingLevel[]) {
  const parts: { name: string; count: number }[] = [];
  let remaining = Math.max(0, Math.floor(baseQuantity));
  for (const level of [...levels].sort((a, b) => b.unitsPerPackage - a.unitsPerPackage)) {
    const count = Math.floor(remaining / level.unitsPerPackage);
    if (count > 0) parts.push({ name: level.name, count });
    remaining -= count * level.unitsPerPackage;
  }
  return parts;
}

export function describeBreakdown(baseQuantity: number, levels: PackagingLevel[]) {
  const parts = breakdown(baseQuantity, levels);
  return parts.length ? parts.map((part) => `${part.count.toLocaleString()} ${part.name}`).join(", ") : `0 ${baseLevel(levels)?.name ?? "units"}`;
}

/** "1 Carton = 10 Pack = 100 Strip = 1,000 Tablet". */
export function describeConversion(levels: PackagingLevel[]) {
  const top = levels[0];
  if (!top || levels.length < 2) return "";
  return levels.map((level, index) => `${index === 0 ? 1 : (top.unitsPerPackage / level.unitsPerPackage).toLocaleString()} ${level.name}`).join(" = ");
}

// ---------------------------------------------------------------- barcodes

/** GS1 mod-10 check digit for the given digits (without the check digit). */
export function gs1CheckDigit(digits: string) {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index]);
    sum += index % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** Returns an error message, or null when the code is valid for the format. */
export function barcodeError(code: string, format: BarcodeFormat): string | null {
  if (format === "EAN13" || format === "UPCA") {
    const length = format === "EAN13" ? 13 : 12;
    if (!new RegExp(`^\\d{${length}}$`).test(code)) return `${format === "EAN13" ? "EAN-13" : "UPC-A"} barcodes have exactly ${length} digits.`;
    if (gs1CheckDigit(code.slice(0, -1)) !== Number(code.slice(-1))) return `The check digit of ${code} is wrong. Re-scan or re-type the barcode.`;
    return null;
  }
  if (code.length < 1 || code.length > 48) return "Code 128 barcodes must be 1–48 characters.";
  if (!/^[\x20-\x7e]+$/.test(code)) return "Code 128 barcodes may only contain printable ASCII characters.";
  return null;
}

/** Best guess of the symbology from a scanned value. */
export function detectBarcodeFormat(code: string): BarcodeFormat {
  if (/^\d{13}$/.test(code) && gs1CheckDigit(code.slice(0, 12)) === Number(code[12])) return "EAN13";
  if (/^\d{12}$/.test(code) && gs1CheckDigit(code.slice(0, 11)) === Number(code[11])) return "UPCA";
  return "CODE128";
}

export function normaliseBarcode(code: string) {
  return code.trim().replace(/\s+/g, "");
}

/**
 * Internal (in-store) EAN-13: GS1 prefix 29 is reserved for restricted in-store use, so it never collides with
 * a manufacturer barcode. 29 + 10-digit sequence + check digit.
 */
export function internalEan13(sequence: number) {
  const body = `29${String(Math.max(0, Math.floor(sequence)) % 10_000_000_000).padStart(10, "0")}`;
  return `${body}${gs1CheckDigit(body)}`;
}
