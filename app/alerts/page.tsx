import { DashboardShell } from "@/components/dashboard-shell";
import { batches, outlets, products } from "@/lib/data";
import { alertSummary, stockPosition, visibleAlerts, expiryWindow, canSeeType } from "@/lib/erp/alerts";
import { INVENTORY_REPORTS } from "@/lib/erp/inventory-reports";
import { daysToExpiry, isExpired, outletName } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { emailConfigured } from "@/lib/notify/email";
import { pushConfigured } from "@/lib/notify/push";
import { can, isOutletScoped } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { AlertsCentre } from "./alerts-centre";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return pageData("alerts.view", "/alerts", async (actor) => {
    const params = await searchParams;
    const tab = typeof params.tab === "string" ? params.tab : undefined;
    const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
    const central = !isOutletScoped(actor.role);
    const requested = typeof params.outlet === "string" ? params.outlet : undefined;
    // Central roles can look at any outlet or all; outlet roles are fixed to their active outlet.
    const outletFilter = central ? (requested === "all" ? null : requested ?? actor.outletId) : actor.outletId;
    const inScope = (id: string) => (outletFilter ? id === outletFilter : central || actor.outletIds.includes(id));

    const alerts = visibleAlerts(actor, outletFilter);
    const summary = alertSummary(actor, outletFilter);
    const openByKey = new Map(alerts.filter((alert) => alert.status !== "RESOLVED").map((alert) => [alert.key, alert]));
    const store = getStore();
    const showExpiry = canSeeType(actor, "EXPIRED");

    const lines = products
      .filter((product) => inScope(product.outletId) && product.status !== "RESTRICTED")
      .map((product) => {
        const position = stockPosition(product);
        const alert = openByKey.get(`LOW_STOCK:${product.outletId}:${product.id}`);
        return {
          id: product.id,
          product: product.name,
          outletId: product.outletId,
          outlet: outletName(product.outletId),
          uom: product.uom,
          available: position.available,
          onHand: product.stock,
          minStock: product.minStock,
          maxStock: product.maxStock ?? null,
          thresholdSource: product.thresholdSource ?? "item",
          target: position.target,
          onOrder: position.onOrder,
          suggested: position.suggested,
          level: !position.low ? "OK" : position.available === 0 ? "Out of stock" : position.critical ? "Critical" : "Low",
          alertId: alert?.id ?? null,
          alertStatus: alert?.status ?? null,
        };
      });

    const batchRows = showExpiry
      ? batches
          .filter((batch) => inScope(batch.assignedOutletId) && batch.availableQuantity > 0)
          .map((batch) => {
            const days = daysToExpiry(batch);
            const expired = isExpired(batch);
            const alert = openByKey.get(`${expired ? "EXPIRED" : "NEAR_EXPIRY"}:${batch.id}`);
            return {
              id: batch.id,
              product: batch.productName,
              batchNumber: batch.batchNumber,
              supplier: batch.supplier,
              outletId: batch.assignedOutletId,
              outlet: outletName(batch.assignedOutletId),
              expiryDate: batch.expiryDate,
              days,
              expired,
              window: expired ? null : expiryWindow(days),
              quantity: batch.availableQuantity,
              value: batch.availableQuantity * batch.purchasePrice,
              disposition: batch.disposition?.status ?? null,
              dispositionNote: batch.disposition ? `${batch.disposition.by} · ${batch.disposition.note ?? ""}` : null,
              alertId: alert?.id ?? null,
              alertStatus: alert?.status ?? null,
            };
          })
          .filter((row) => row.expired || row.window !== null)
      : [];

    const canDeliveries = can(actor, "reports.consolidated");

    const emailReady = await emailConfigured();
    return (
      <DashboardShell>
        <AlertsCentre
          initialTab={tab}
          initialQuery={q}
          config={can(actor, "alerts.configure") ? { lowStock: store.settings.lowStock, alertEmail: store.settings.alertEmail, productNames: Array.from(new Set(products.map((product) => product.name))).sort() } : null}
          summary={summary}
          lines={lines}
          batches={batchRows}
          alerts={alerts.map((alert) => ({ ...alert, outlet: outletName(alert.outletId) }))}
          intervals={[...store.settings.expiryIntervals].sort((a, b) => b - a)}
          outlets={central ? outlets.filter((outlet) => outlet.status !== "CLOSED").map((outlet) => ({ id: outlet.id, name: outlet.name })) : []}
          outletFilter={outletFilter}
          scope={outletFilter ? outletName(outletFilter) : "All outlets"}
          reports={Object.entries(INVENTORY_REPORTS).map(([key, value]) => ({ key, title: value.title, description: value.description }))}
          deliveries={canDeliveries ? store.deliveries.slice(0, 300) : []}
          channels={{ email: emailReady, push: pushConfigured(), devices: store.devices.length, lastDaily: store.jobRuns.daily ?? null, lastMonthly: store.jobRuns.monthly ?? null, summaryHour: store.settings.dailySummaryHour }}
          permissions={{
            manage: can(actor, "alerts.manage"),
            expiry: showExpiry,
            reports: can(actor, "reports.inventory") || can(actor, "alerts.manage"),
            stockRequest: can(actor, "stock.request"),
            central,
            deliveries: canDeliveries,
          }}
        />
      </DashboardShell>
    );
  });
}
