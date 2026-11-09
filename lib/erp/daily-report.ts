// The daily pharmacy report: one business day, all outlets. Built only from the existing report logic
// (buildReport for sales, payments, expenses, profit and items; alertSummary for stock and expiry), so the
// WhatsApp summary, the full-report page and the Reports screens always agree.
import { products } from "@/lib/data";
import { alertSummary } from "@/lib/erp/alerts";
import { buildReport } from "@/lib/erp/reports";
import { localToday } from "@/lib/erp/sales-overview";
import { getStore } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";

const DAY = 86_400_000;

/** The business day before now (West Africa Time): what a morning report covers. */
export function previousBusinessDay(now = Date.now()) {
  return localToday(now - DAY);
}

const REPORTER: Actor = {
  id: "system",
  name: "Daily report",
  role: "SUPER_ADMIN",
  outletId: null,
  outletIds: [],
  permissions: ["reports.sales", "reports.financial", "reports.inventory", "reports.consolidated", "alerts.manage", "alerts.view"],
} as unknown as Actor;

export const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

export function buildDailyReport(day: string) {
  const report = buildReport(REPORTER, { days: 1, outletId: null, day });
  const alerts = alertSummary(REPORTER, null);
  const store = getStore();
  // Gross profit is shown only when every item sold that day has a recorded cost price.
  const daySales = store.sales.filter((sale) => sale.status !== "Voided" && sale.date >= new Date(Date.parse(`${day}T00:00:00+01:00`)).toISOString() && sale.date < new Date(Date.parse(`${day}T00:00:00+01:00`) + DAY).toISOString());
  const profitReliable = daySales.every((sale) => sale.lines.every((line) => (products.find((product) => product.id === line.productId)?.purchasePrice ?? 0) > 0));
  return {
    day,
    pharmacy: store.settings.businessName,
    totalSales: report.summary.revenue,
    transactions: report.summary.invoices,
    byOutlet: report.byOutlet.map((row) => ({ id: row.id, name: row.name, revenue: row.revenue, invoices: row.invoices })),
    byMethod: report.byMethod.filter((row) => row.amount > 0 || row.invoices > 0),
    expenses: report.summary.operatingExpenses,
    expenseLines: report.expenses,
    grossProfit: profitReliable ? report.summary.grossProfit : null,
    topProducts: report.byItem.slice(0, 5).map((row) => ({ name: row.name, quantity: row.quantity, revenue: row.revenue })),
    lowStock: alerts.lowStock,
    outOfStock: alerts.outOfStock,
    criticalOutlets: alerts.criticalOutlets,
    expiredBatches: alerts.expiredBatches,
    expiredValue: alerts.expiredValue,
    nearExpiry: alerts.nearExpiryProducts,
  };
}

export type DailyReport = ReturnType<typeof buildDailyReport>;

/** Payment breakdown for one outlet on that day (cash / POS terminal / transfer), from the same tenders. */
export function outletPayments(day: string, outletId: string) {
  const report = buildReport(REPORTER, { days: 1, outletId, day });
  const amount = (method: string) => report.byMethod.find((row) => row.method === method)?.amount ?? 0;
  return { cash: amount("Cash"), pos: amount("POS terminal"), transfer: amount("Transfer") };
}
