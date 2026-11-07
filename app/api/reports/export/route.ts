import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import { buildReport } from "@/lib/erp/reports";
import { getActor } from "@/lib/session";
import { canAny } from "@/lib/rbac";
import { withDatabaseTransaction } from "@/lib/db/database";

type Column = { header: string; key: string; width?: number; money?: boolean; percent?: boolean };

const NAIRA = '"₦"#,##0';

function addSheet(book: ExcelJS.Workbook, name: string, columns: Column[], rows: Record<string, unknown>[]) {
  const sheet = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width ?? 16 }));
  sheet.addRows(rows);
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15803D" } };
  columns.forEach((column, index) => {
    if (column.money) sheet.getColumn(index + 1).numFmt = NAIRA;
    if (column.percent) sheet.getColumn(index + 1).numFmt = '0.0"%"';
  });
  return sheet;
}

/** The whole export runs in the pharmacy's transaction: report data, and its audit entry, belong to that pharmacy. */
export async function GET(request: Request) {
  return withDatabaseTransaction(() => exportReport(request));
}

async function exportReport(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!canAny(actor, ["reports.sales", "reports.inventory", "reports.financial"])) return NextResponse.json({ error: "Your role cannot export reports." }, { status: 403 });

  const url = new URL(request.url);
  const outletParam = url.searchParams.get("outlet");
  const report = buildReport(actor, { days: Number(url.searchParams.get("days") ?? 30), outletId: outletParam === "all" ? null : outletParam || actor.outletId });
  const { summary: s, meta } = report;

  const book = new ExcelJS.Workbook();
  book.creator = "Pharmacy ERP";
  book.created = new Date();

  const summary = book.addWorksheet("Summary");
  summary.columns = [{ width: 32 }, { width: 22 }];
  summary.addRows([
    ["Pharmacy ERP — Management report"],
    ["Scope", meta.scopeLabel],
    ["Period", `${meta.from} to ${meta.to} (${meta.days} days)`],
    ["Generated", `${new Date(meta.generatedAt).toLocaleString("en-GB")} by ${meta.generatedBy}`],
    [],
  ]);
  const money: [string, number][] = [
    ["Revenue (incl. VAT)", s.revenue],
    ["Net sales (excl. VAT)", s.netSales],
    ["Output VAT", s.vat],
    ...(meta.sections.financial
      ? ([
          ["Cost of goods sold", s.cogs],
          ["Gross profit", s.grossProfit],
          ["Operating expenses", s.operatingExpenses],
          ["Net operating profit", s.netProfit],
        ] as [string, number][])
      : []),
    ["Average basket", s.avgBasket],
  ];
  for (const [label, value] of money) summary.addRow([label, value]).getCell(2).numFmt = NAIRA;
  if (meta.sections.financial) summary.addRow(["Gross margin %", s.grossMargin]);
  summary.addRow(["Invoices", s.invoices]);
  summary.addRow(["Voided invoices", s.voided]);
  summary.getRow(1).font = { bold: true, size: 14, color: { argb: "FF15803D" } };

  addSheet(book, "Sales by item", [
    { header: "Item", key: "name", width: 34 }, { header: "Qty", key: "quantity" }, { header: "Net revenue", key: "revenue", money: true },
    { header: "Cost", key: "cost", money: true }, { header: "Gross profit", key: "grossProfit", money: true }, { header: "Margin %", key: "margin", percent: true },
    { header: "Share %", key: "share", percent: true },
  ], report.byItem);
  addSheet(book, "Sales by outlet", [
    { header: "Outlet", key: "name", width: 32 }, { header: "Invoices", key: "invoices" }, { header: "Revenue", key: "revenue", money: true },
    { header: "VAT", key: "vat", money: true }, { header: "Gross profit", key: "grossProfit", money: true }, { header: "Margin %", key: "margin", percent: true },
  ], report.byOutlet);
  addSheet(book, "Payment methods", [
    { header: "Method", key: "method" }, { header: "Invoices", key: "invoices" }, { header: "Amount", key: "amount", money: true }, { header: "Share %", key: "share", percent: true },
  ], report.byMethod);
  addSheet(book, "Stock valuation", [
    { header: "Location", key: "name", width: 32 }, { header: "SKUs", key: "skus" }, { header: "Units", key: "units" }, { header: "Cost value", key: "costValue", money: true },
    { header: "Retail value", key: "retailValue", money: true }, { header: "Expired (cost)", key: "expiredValue", money: true }, { header: "Expiring ≤90d (cost)", key: "expiring90Value", money: true, width: 20 },
  ], report.stock);
  addSheet(book, "VAT", [
    { header: "Month", key: "month", width: 20 }, { header: "Invoices", key: "invoices" }, { header: "Taxable sales", key: "taxableSales", money: true },
    { header: "Output VAT (7.5%)", key: "outputVat", money: true, width: 18 }, { header: "Return due", key: "dueDate" },
  ], report.vatMonthly);
  addSheet(book, "Purchases", [
    { header: "Supplier", key: "name", width: 30 }, { header: "POs", key: "orders" }, { header: "Ordered", key: "ordered", money: true },
    { header: "Received", key: "received", money: true }, { header: "Fill rate %", key: "fillRate", percent: true }, { header: "Payable", key: "outstanding", money: true },
  ], report.purchases);
  addSheet(book, "Expenses", [
    { header: "Category", key: "category", width: 24 }, { header: "Vouchers", key: "count" }, { header: "Amount", key: "amount", money: true }, { header: "Share %", key: "share", percent: true },
  ], report.expenses);

  const buffer = await book.xlsx.writeBuffer();
  const fileName = `pharmacy-erp-report-${meta.to}-${meta.days}d.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
