import { NextResponse } from "next/server";

import { salesOverviewExcel } from "@/lib/erp/report-export";
import { buildSalesOverview, type TrendGranularity } from "@/lib/erp/sales-overview";
import { DomainError, recordAudit } from "@/lib/erp/services";
import { salesOverviewPdf } from "@/lib/pdf/sales-overview-pdf";
import { withDatabaseTransaction } from "@/lib/db/database";
import { getActor } from "@/lib/session";
import { subscriptionAccessProblem } from "@/lib/saas/subscriptions";

const TRENDS: TrendGranularity[] = ["daily", "weekly", "monthly", "yearly"];

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&outlet=all|<id>&trend=daily|weekly|monthly|yearly&format=json|pdf|xlsx */
export async function GET(request: Request) {
  try {
    return await withDatabaseTransaction(async () => {
      const actor = await getActor();
      if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
      if (!actor.support) {
        const problem = await subscriptionAccessProblem();
        if (problem) return NextResponse.json({ error: problem }, { status: 402 });
      }
      const url = new URL(request.url);
      const trend = url.searchParams.get("trend") as TrendGranularity | null;
      const format = url.searchParams.get("format") ?? "json";
      const overview = buildSalesOverview(actor, {
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        outlet: url.searchParams.get("outlet"),
        trend: trend && TRENDS.includes(trend) ? trend : "daily",
      });
      if (format === "json") return NextResponse.json(overview);
      const name = `sales-overview-${overview.meta.from}${overview.meta.to !== overview.meta.from ? `_${overview.meta.to}` : ""}`;
      recordAudit(actor, { action: "reports.export", entity: "SalesOverview", entityId: name, summary: `Exported sales overview ${overview.meta.from}–${overview.meta.to} (${overview.meta.scopeLabel}) as ${format.toUpperCase()}`, outletId: actor.outletId });
      if (format === "pdf") return new NextResponse(new Uint8Array(await salesOverviewPdf(overview)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` } });
      if (format === "xlsx") return new NextResponse(new Uint8Array(await salesOverviewExcel(overview)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
      return NextResponse.json({ error: "Format must be json, pdf or xlsx." }, { status: 400 });
    });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Could not build the sales overview." }, { status: 500 });
  }
}
