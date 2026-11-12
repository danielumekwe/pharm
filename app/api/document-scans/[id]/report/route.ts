import { jobReport } from "@/lib/erp/document-scans";
import { guarded } from "@/lib/session";

/** Migration report (CSV, formula-safe). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded(["documents.scan", "documents.approve"], async (actor) => {
    const report = await jobReport(actor, id);
    return new Response(report.content, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report.fileName}"`, "Cache-Control": "private, no-store" },
    });
  });
}
