import { alertSummary, visibleAlerts } from "@/lib/erp/alerts";
import { outletName } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

/** Alerts feed for the web dashboard and the Android admin app. Filters: outlet, type, status, severity. */
export async function GET(request: Request) {
  return guarded("alerts.view", (actor) => {
    const url = new URL(request.url);
    const outlet = url.searchParams.get("outlet");
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const severity = url.searchParams.get("severity");
    const outletFilter = outlet && outlet !== "all" ? outlet : outlet === "all" ? null : undefined;
    const alerts = visibleAlerts(actor, outletFilter)
      .filter((alert) => (!type || alert.type === type) && (!status || alert.status === status) && (!severity || alert.severity === severity))
      .slice(0, 500)
      .map((alert) => ({ ...alert, outletName: outletName(alert.outletId), notified: undefined }));
    return { summary: alertSummary(actor, outletFilter), alerts };
  });
}
