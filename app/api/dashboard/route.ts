import { buildDashboard } from "@/lib/erp/dashboards";
import { guarded } from "@/lib/session";
import type { TrendGranularity } from "@/lib/erp/sales-overview";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters = {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    outlet: searchParams.get("outlet"),
    trend: (searchParams.get("trend") ?? undefined) as TrendGranularity | undefined,
  };
  return guarded("dashboard.view", (actor) => buildDashboard(actor, filters));
}
