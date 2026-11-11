// Reads uploaded import files (.xlsx, .csv) into plain text cells, and writes the downloadable templates.
// Uploads are checked by size, extension and content (zip signature and expanded size for .xlsx, text for
// .csv) before any parser sees them.

import { createHash } from "node:crypto";

import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";

import { columnGuide, IMPORT_KIND_LABELS, templateColumns, templateRows, toCsv, type ImportKind } from "@/lib/erp/import-format";
import { DomainError } from "@/lib/erp/services";

/** Vercel accepts request bodies up to 4.5 MB. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_ROWS = 5000;
const MAX_COLUMNS = 60;
const MAX_CELL = 500;
/** Expanded size of all parts of an .xlsx (a small zip that inflates to gigabytes is rejected). */
const MAX_XLSX_EXPANDED = 60 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

export type SheetData = {
  headers: string[];
  rows: string[][];
  /** Spreadsheet row number of each data row (for messages such as "row 12"). */
  rowNumbers: number[];
};

export function fileHash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const LEGACY_XLS = "Old Excel .xls files are not supported. Open the file in Excel and use File → Save As → Excel Workbook (.xlsx) or CSV.";

/** Reads the zip central directory and refuses archives that expand too far or hold too many parts. */
function assertSafeZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65_535); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new DomainError("The file is not a valid Excel workbook (damaged or incomplete upload).");
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (entries > MAX_ZIP_ENTRIES || offset >= bytes.length) throw new DomainError("The workbook structure is not valid.");
  let expanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new DomainError("The workbook structure is not valid.");
    expanded += view.getUint32(offset + 24, true);
    if (expanded > MAX_XLSX_EXPANDED) throw new DomainError("The workbook expands to more than 60 MB. Split it into smaller files.");
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(0) : String(value);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("formula" in value || "sharedFormula" in value) return cellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
    if ("error" in value) return "";
  }
  return "";
}

function clean(text: string) {
  // Control characters (other than tab) are dropped; very long cells are cut.
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX_CELL);
}

function tabulate(grid: string[][], rowNumbers: number[]): SheetData {
  const headerAt = grid.findIndex((row) => row.some((cell) => cell));
  if (headerAt < 0) throw new DomainError("The file is empty.");
  const raw = grid[headerAt];
  let width = raw.length;
  while (width > 0 && !raw[width - 1]) width -= 1;
  if (width > MAX_COLUMNS) throw new DomainError(`The file has ${width} columns; at most ${MAX_COLUMNS} are supported.`);
  const seen = new Map<string, number>();
  const headers = raw.slice(0, width).map((header, index) => {
    const name = header || `Column ${index + 1}`;
    const count = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), count);
    return count > 1 ? `${name} (${count})` : name;
  });
  const rows: string[][] = [];
  const numbers: number[] = [];
  for (let index = headerAt + 1; index < grid.length; index += 1) {
    const row = Array.from({ length: width }, (_, column) => grid[index][column] ?? "");
    if (!row.some((cell) => cell)) continue;
    rows.push(row);
    numbers.push(rowNumbers[index]);
    if (rows.length > MAX_ROWS) throw new DomainError(`The file has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files.`);
  }
  if (!rows.length) throw new DomainError("The file has a header row but no data rows.");
  return { headers, rows, rowNumbers: numbers };
}

async function readXlsx(bytes: Uint8Array): Promise<SheetData> {
  assertSafeZip(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new DomainError("The file could not be read as an Excel workbook. Save it again as .xlsx or CSV.");
  }
  // First sheet with data, skipping the template's column guide.
  const sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 0 && !/guide|instruction|read ?me/i.test(candidate.name));
  if (!sheet) throw new DomainError("The workbook has no data.");
  if (sheet.rowCount > MAX_ROWS + 50) throw new DomainError(`The sheet has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files.`);
  const grid: string[][] = [];
  const numbers: number[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    const count = Math.min(row.cellCount, MAX_COLUMNS + 1);
    for (let column = 1; column <= count; column += 1) cells.push(clean(cellText(row.getCell(column).value)));
    grid.push(cells);
    numbers.push(rowNumber);
  });
  return tabulate(grid, numbers);
}

function readCsv(bytes: Uint8Array): SheetData {
  if (bytes.includes(0)) throw new DomainError("The CSV file contains binary data. Export it again as plain CSV text.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Older Windows POS exports.
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((candidate) => ({ candidate, count: firstLine.split(candidate).length })).sort((a, b) => b.count - a.count)[0].candidate;
  let records: string[][];
  try {
    records = parse(text, { delimiter, relax_column_count: true, skip_empty_lines: false, bom: true, max_record_size: 64 * 1024 }) as string[][];
  } catch (error) {
    throw new DomainError(`The CSV file is malformed: ${(error as Error).message.split("\n")[0]}`);
  }
  return tabulate(records.map((row) => row.map(clean)), records.map((_, index) => index + 1));
}

/** Validates and parses an uploaded file. */
export async function readImportFile(fileName: string, bytes: Uint8Array): Promise<SheetData> {
  if (!bytes.length) throw new DomainError("The file is empty.");
  if (bytes.length > MAX_FILE_BYTES) throw new DomainError("The file is larger than 4 MB. Split it into smaller files.", 413);
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (extension === "xls" || startsWith(bytes, OLE)) throw new DomainError(LEGACY_XLS);
  if (extension === "xlsx") {
    if (!startsWith(bytes, ZIP)) throw new DomainError("The file is not a valid .xlsx workbook.");
    return readXlsx(bytes);
  }
  if (extension === "csv" || extension === "txt") {
    if (startsWith(bytes, ZIP)) throw new DomainError("This looks like an Excel workbook saved with a .csv name. Rename it to .xlsx or export it as CSV.");
    return readCsv(bytes);
  }
  throw new DomainError("Upload an Excel (.xlsx) or CSV (.csv) file.");
}

// ---------------------------------------------------------------- templates

export async function templateFile(kind: ImportKind, format: "xlsx" | "csv") {
  const columns = templateColumns(kind);
  const rows = templateRows(kind);
  const name = `pharmaerp-${kind === "both" ? "products-and-stock" : kind === "stock" ? "opening-stock" : "products"}-template`;
  if (format === "csv") {
    return { name: `${name}.csv`, type: "text/csv; charset=utf-8", body: new TextEncoder().encode(toCsv([columns.map((column) => column.label), ...rows])) };
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PharmaERP";
  const sheet = workbook.addWorksheet("Import");
  sheet.columns = columns.map((column) => ({ header: column.label, key: column.key, width: Math.max(14, Math.min(42, column.label.length + 6, column.example.length + 4)) }));
  // Text format so Excel keeps barcodes, codes and dates exactly as typed.
  sheet.columns.forEach((column) => {
    column.numFmt = "@";
  });
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF188030" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const guide = workbook.addWorksheet("Column guide");
  guide.columns = [
    { header: "Column", key: "column", width: 22 },
    { header: "Required", key: "required", width: 20 },
    { header: "What to enter", key: "description", width: 90 },
    { header: "Example", key: "example", width: 40 },
  ];
  guide.getRow(1).font = { bold: true };
  for (const entry of columnGuide(kind)) guide.addRow(entry);
  guide.addRow({});
  guide.addRow({ column: "Notes", description: `${IMPORT_KIND_LABELS[kind]} template. Delete the sample rows before importing. One row per batch: a product with three batches has three rows with the same product details.` });
  guide.addRow({ description: "Prices are per base unit unless you choose \"per quantity unit\" on the import screen. Quantities are converted to base units with each product's own packaging." });
  guide.addRow({ description: "Only this first sheet is imported. CSV files from other systems work too: you match their columns on the import screen." });
  guide.getColumn("description").alignment = { wrapText: true, vertical: "top" };
  const buffer = await workbook.xlsx.writeBuffer();
  return { name: `${name}.xlsx`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: new Uint8Array(buffer as ArrayBuffer) };
}
