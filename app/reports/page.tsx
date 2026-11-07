import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { buildReport, REPORT_PERIODS } from "@/lib/erp/reports";
import { pageData } from "@/lib/session";

import { ReportsView } from "./reports-view";

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return pageData(["reports.sales", "reports.inventory", "reports.financial"], "/reports", async (actor) => {
    const params = await searchParams;
    const days = Number(Array.isArray(params.days) ? params.days[0] : params.days) || 30;
    const outlet = Array.isArray(params.outlet) ? params.outlet[0] : params.outlet;

    const report = buildReport(actor, { days, outletId: outlet === "all" ? null : outlet && outlets.some((row) => row.id === outlet) ? outlet : actor.outletId });

    return (
      <DashboardShell>
        <ReportsView
          report={report}
          periods={[...REPORT_PERIODS]}
          outlets={outlets.filter((row) => row.type !== "WAREHOUSE").map((row) => ({ id: row.id, name: row.name }))}
        />
      </DashboardShell>
    );
  });
}
