import { buildDailyReport, previousBusinessDay } from "@/lib/erp/daily-report";
import { can } from "@/lib/rbac";
import { guarded } from "@/lib/session";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The daily pharmacy report as JSON (mobile app; same figures as /reports/daily and the WhatsApp summary).
 * ?date=YYYY-MM-DD, default yesterday (West Africa Time). Expenses and profit need financial reporting rights.
 */
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  return guarded("reports.consolidated", (actor) => {
    const report = buildDailyReport(date && DAY.test(date) ? date : previousBusinessDay());
    if (can(actor, "reports.financial")) return { ...report, financial: true };
    return { ...report, expenses: null, expenseLines: [], grossProfit: null, financial: false };
  });
}
