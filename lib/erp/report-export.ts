import ExcelJS from "exceljs";

import type { InventoryReport } from "@/lib/erp/inventory-reports";

const NAIRA = '"₦"#,##0';

/** One worksheet per report, with a title block, frozen header and totals row. */
export async function inventoryReportsExcel(reports: InventoryReport[]) {
  const book = new ExcelJS.Workbook();
  book.creator = reports[0]?.businessName ?? "Pharmacy ERP";
  book.created = new Date();
  for (const report of reports) {
    const sheet = book.addWorksheet(report.title.slice(0, 31));
    sheet.addRow([report.title]).font = { bold: true, size: 14, color: { argb: "FF15803D" } };
    sheet.addRow([`${report.scopeLabel} · ${report.filtersLabel}`]);
    sheet.addRow([`Generated ${new Date(report.generatedAt).toLocaleString("en-GB")} by ${report.generatedBy}`]);
    sheet.addRow([]);
    const header = sheet.addRow(report.columns.map((column) => column.header));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15803D" } }));
    sheet.views = [{ state: "frozen", ySplit: 5 }];
    for (const row of report.rows) {
      sheet.addRow(report.columns.map((column) => (column.type === "date" ? new Date(String(row[column.key])) : row[column.key])));
    }
    if (report.rows.length && Object.keys(report.totals).length) {
      const totals = sheet.addRow(report.columns.map((column, index) => (index === 0 ? `Total (${report.rows.length})` : (report.totals[column.key] ?? ""))));
      totals.font = { bold: true };
    }
    report.columns.forEach((column, index) => {
      const col = sheet.getColumn(index + 1);
      col.width = column.key === "product" || column.key === "source" ? 34 : column.type === "text" ? 22 : 15;
      if (column.type === "money") col.numFmt = NAIRA;
      if (column.type === "percent") col.numFmt = '0.0"%"';
      if (column.type === "date") col.numFmt = "dd mmm yyyy";
    });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** Sales overview workbook: summary, outlets, cashiers and trend. */
export async function salesOverviewExcel(overview: import("@/lib/erp/sales-overview").SalesOverview) {
  const { meta, totals: t } = overview;
  const book = new ExcelJS.Workbook();
  book.creator = meta.businessName;
  const summary = book.addWorksheet("Summary");
  summary.columns = [{ width: 38 }, { width: 20 }];
  summary.addRow(["Daily sales overview"]).font = { bold: true, size: 14, color: { argb: "FF15803D" } };
  summary.addRow([`${meta.from} to ${meta.to} · ${meta.scopeLabel}`]);
  summary.addRow([`Generated ${new Date(meta.generatedAt).toLocaleString("en-GB")} by ${meta.generatedBy}`]);
  summary.addRow([]);
  const rows: [string, number][] = [
    ["Gross sales (excl. VAT)", t.gross],
    ["Discounts", t.discounts],
    ["Returns & refunds (excl. VAT)", t.returns],
    ["Net sales", t.net],
    ["Output VAT (net of returns)", t.vat],
    ["Cash collected", t.payments.cash],
    ["Cash refunded", t.payments.refundCash],
    ["Bank transfer collected", t.payments.transfer],
    ["Bank transfer refunded", t.payments.refundTransfer],
    ["POS terminal collected", t.payments.pos],
    ["POS terminal refunded", t.payments.refundPos],
    ["On account (credit / HMO)", t.payments.onAccount],
    ["Voided value (excluded)", t.voidedValue],
  ];
  for (const [label, value] of rows) summary.addRow([label, value]).getCell(2).numFmt = NAIRA;
  summary.addRow(["Completed transactions", t.transactions]);
  summary.addRow(["Returns processed", t.returnsCount]);
  summary.addRow(["Voided invoices (excluded)", t.voided]);
  summary.addRow([]);
  summary.addRow(["Net sales = gross − discounts − returns (excluding VAT). Voided invoices are excluded. Dates in West Africa Time."]);

  const table = (name: string, headers: string[], data: (string | number)[][], moneyColumns: number[]) => {
    const sheet = book.addWorksheet(name);
    const header = sheet.addRow(headers);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15803D" } }));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of data) sheet.addRow(row);
    headers.forEach((_, index) => {
      sheet.getColumn(index + 1).width = index === 0 ? 30 : 16;
      if (moneyColumns.includes(index)) sheet.getColumn(index + 1).numFmt = NAIRA;
    });
  };
  table("By outlet", ["Outlet", "Transactions", "Gross", "Discounts", "Returns", "Net sales", "VAT", "Cash", "Transfer", "POS", "On account", "Voided"], overview.byOutlet.map((row) => [row.name, row.transactions, row.gross, row.discounts, row.returns, row.net, row.vat, row.payments.netCash, row.payments.netTransfer, row.payments.netPos, row.payments.onAccount, row.voided]), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  table("By cashier", ["Cashier", "Outlet(s)", "Transactions", "Gross", "Discounts", "Returns", "Net sales", "Avg basket", "Voids"], overview.byCashier.map((row) => [row.cashier, row.outlets, row.transactions, row.gross, row.discounts, row.returns, row.net, row.avgBasket, row.voided]), [3, 4, 5, 6, 7]);
  table(`Trend (${meta.trend})`, ["Period", "Transactions", "Gross", "Net sales"], overview.trend.map((row) => [row.label, row.transactions, row.gross, row.net]), [2, 3]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
