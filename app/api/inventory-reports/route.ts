import { NextResponse } from "next/server";

import { buildInventoryReport, INVENTORY_REPORTS, isReportKind, type InventoryReportKind } from "@/lib/erp/inventory-reports";
import { inventoryReportsExcel } from "@/lib/erp/report-export";
import { DomainError, recordAudit } from "@/lib/erp/services";
import { inventoryReportPdf } from "@/lib/pdf/inventory-report-pdf";
import { canAny } from "@/lib/rbac";
import { getActor } from "@/lib/session";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET ?kind=low-stock|expired|near-expiry|shortages|expired-value|replenishment|all &format=json|pdf|xlsx &outlet &product &batch &from &to */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!canAny(actor, ["reports.inventory", "alerts.manage"])) return NextResponse.json({ error: "Your role cannot run inventory reports." }, { status: 403 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "low-stock";
  const format = url.searchParams.get("format") ?? "json";
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return NextResponse.json({ error: "Dates must be YYYY-MM-DD." }, { status: 400 });
  const outlet = url.searchParams.get("outlet");
  const filters = {
    outletId: outlet && outlet !== "all" ? outlet : outlet === "all" ? null : actor.outletId,
    product: url.searchParams.get("product")?.slice(0, 80) ?? undefined,
    batch: url.searchParams.get("batch")?.slice(0, 40) ?? undefined,
    from,
    to,
  };

  try {
    const kinds: InventoryReportKind[] = kind === "all" ? (Object.keys(INVENTORY_REPORTS) as InventoryReportKind[]) : isReportKind(kind) ? [kind] : [];
    if (!kinds.length) return NextResponse.json({ error: "Unknown report." }, { status: 400 });
    const reports = kinds.map((item) => buildInventoryReport(actor, item, filters));
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "json") return NextResponse.json(kind === "all" ? reports : reports[0]);
    recordAudit(actor, { action: "reports.export", entity: "InventoryReport", entityId: kind, summary: `Exported ${kind === "all" ? "all inventory reports" : reports[0].title} as ${format.toUpperCase()} (${reports[0].scopeLabel}; ${reports[0].filtersLabel})`, outletId: actor.outletId });
    if (format === "xlsx") {
      return new NextResponse(new Uint8Array(await inventoryReportsExcel(reports)), {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${kind}-${stamp}.xlsx"` },
      });
    }
    if (format === "pdf") {
      if (reports.length !== 1) return NextResponse.json({ error: "Choose a single report for PDF." }, { status: 400 });
      return new NextResponse(new Uint8Array(await inventoryReportPdf(reports[0])), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${kind}-${stamp}.pdf"` },
      });
    }
    return NextResponse.json({ error: "Format must be json, pdf or xlsx." }, { status: 400 });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Could not build the report." }, { status: 500 });
  }
}
