import { importReport } from "@/lib/erp/inventory-import";
import { guarded } from "@/lib/session";

/** GET ?type=rejected|success|all → CSV (formula-safe). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const type = new URL(request.url).searchParams.get("type") ?? "all";
  return guarded("inventory.import", (actor) => importReport(actor, id, type));
}
