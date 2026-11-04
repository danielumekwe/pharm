import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { buildSalesOverview, localToday, type TrendGranularity } from "@/lib/erp/sales-overview";
import { DomainError } from "@/lib/erp/services";
import { requirePage } from "@/lib/session";

import { SalesOverviewView } from "./overview-view";

const TRENDS: TrendGranularity[] = ["daily", "weekly", "monthly", "yearly"];

export default async function SalesOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePage(["reports.sales", "sales.view"], "/sales-overview");
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const trend = TRENDS.find((item) => item === value("trend")) ?? "daily";

  let overview = null;
  let error: string | null = null;
  try {
    overview = buildSalesOverview(actor, { from: value("from"), to: value("to"), outlet: value("outlet"), trend });
  } catch (cause) {
    if (!(cause instanceof DomainError)) throw cause;
    error = cause.message;
  }

  return (
    <DashboardShell>
      <SalesOverviewView
        overview={overview}
        error={error}
        today={localToday()}
        outlets={outlets.filter((outlet) => outlet.type !== "WAREHOUSE").map((outlet) => ({ id: outlet.id, name: outlet.name }))}
      />
    </DashboardShell>
  );
}
