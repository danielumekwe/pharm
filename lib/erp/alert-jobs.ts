// Scheduled inventory jobs: daily alert summary and monthly stock monitoring report.

import { users } from "@/lib/data";
import { actorFor } from "@/lib/erp/access";
import { alertSummary, deliverEmail, processEmailRetries, scanAlerts } from "@/lib/erp/alerts";
import { buildInventoryReport, INVENTORY_REPORTS, type InventoryReportKind } from "@/lib/erp/inventory-reports";
import { inventoryReportsExcel } from "@/lib/erp/report-export";
import { outletName, recordAudit } from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { sendEmail } from "@/lib/notify/email";
import { isOutletScoped } from "@/lib/rbac";

const SYSTEM = { id: "system", name: "Scheduler", role: "SUPER_ADMIN" as const };

function localDate(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function log(recipient: Actor & { email: string }, channel: "IN_APP" | "EMAIL", subject: string, event: string, status: "SENT" | "SKIPPED" | "FAILED", detail: string) {
  getStore().deliveries.unshift({ id: `dlv-${nextNumber("delivery")}`, at: new Date().toISOString(), channel, recipientId: recipient.id, recipientName: recipient.name, subject, event, status, detail });
}

/** Active users who manage alerts or hold inventory reporting rights, as actors with their real access. */
function digestAudience(filter: (actor: Actor) => boolean) {
  return users
    .map((user) => ({ user, actor: actorFor(user, null) }))
    .filter((entry): entry is { user: (typeof users)[number]; actor: Actor } => entry.actor !== null)
    .filter(({ actor }) => filter(actor))
    .map(({ user, actor }) => ({ ...actor, email: user.email }));
}

export async function runDailySummary(trigger: Pick<Actor, "id" | "name" | "role"> = SYSTEM, now = new Date()) {
  scanAlerts(now.getTime());
  const store = getStore();
  const day = localDate(now);
  const event = `daily-summary:${day}`;
  const audience = digestAudience((actor) => actor.permissions.includes("alerts.manage") || actor.permissions.includes("reports.consolidated"));
  let sent = 0;
  let alreadySent = 0;

  for (const recipient of audience) {
    if (store.deliveries.some((delivery) => delivery.recipientId === recipient.id && delivery.event === event && delivery.channel === "IN_APP")) {
      alreadySent += 1;
      continue;
    }
    const summary = alertSummary({ ...recipient, outletId: null }, null);
    const scope = isOutletScoped(recipient.role) ? recipient.outletIds.map(outletName).join(", ") : "all outlets";
    const lines = [
      `Inventory alert summary for ${scope} — ${day}`,
      `• Low-stock products: ${summary.lowStock} (${summary.outOfStock} out of stock)`,
      `• Outlets with critical shortages: ${summary.criticalOutlets.map((row) => `${row.name} (${row.count})`).join(", ") || "none"}`,
      ...(summary.showExpiry
        ? [`• Expired batches: ${summary.expiredBatches} — ₦${summary.expiredValue.toLocaleString()} at cost`, `• Products approaching expiry: ${summary.nearExpiryProducts}`]
        : []),
      `• Unacknowledged alerts: ${summary.unacknowledged}`,
    ];
    const title = `Daily inventory summary · ${summary.lowStock} low · ${summary.expiredBatches} expired`;
    store.notifications.unshift({ id: `ntf-${nextNumber("notification")}`, userId: recipient.id, title, body: lines.slice(1).join("\n"), severity: summary.criticalOutlets.length || summary.expiredBatches ? "warning" : "info", link: "/alerts", createdAt: new Date().toISOString() });
    log(recipient, "IN_APP", title, event, "SENT", "Shown in notification centre");
    if (store.settings.alertEmail.enabled) {
      await deliverEmail({ recipientId: recipient.id, recipientName: recipient.name, event, payload: { to: recipient.email, subject: `[Pharmacy ERP] ${title}`, text: `${lines.join("\n")}\n\nOpen the alerts centre: ${process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? ""}/alerts` } });
    }
    sent += 1;
  }

  // Extra configured recipients get one consolidated (all-outlet) summary each.
  const config = store.settings.alertEmail;
  if (config.enabled && config.recipients.length) {
    const all = alertSummary({ id: "system", name: "Scheduler", role: "SUPER_ADMIN", outletId: null, outletIds: [], permissions: ["alerts.manage", "reports.inventory", "alerts.view"] }, null);
    const text = [
      `Inventory alert summary for all outlets — ${day}`,
      `• Low-stock products: ${all.lowStock} (${all.outOfStock} out of stock)`,
      `• Outlets with critical shortages: ${all.criticalOutlets.map((row) => `${row.name} (${row.count})`).join(", ") || "none"}`,
      `• Expired batches: ${all.expiredBatches} — ₦${all.expiredValue.toLocaleString()} at cost`,
      `• Products approaching expiry: ${all.nearExpiryProducts}`,
      "",
      `Open the alerts centre: ${process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? ""}/alerts`,
    ].join("\n");
    for (const email of config.recipients) {
      if (store.deliveries.some((delivery) => delivery.event === event && delivery.recipientEmail === email)) continue;
      await deliverEmail({ recipientId: `email:${email}`, recipientName: email, event, payload: { to: email, subject: `[Pharmacy ERP] Daily inventory summary · ${all.lowStock} low · ${all.expiredBatches} expired`, text } });
      sent += 1;
    }
  }
  store.jobRuns.daily = day;
  recordAudit(trigger, { action: "alerts.daily-summary", entity: "Job", entityId: event, summary: `Daily inventory summary sent to ${sent} recipient(s)${alreadySent ? `; ${alreadySent} already received today's summary` : ""}` });
  return { job: "daily", day, recipients: sent, alreadySent };
}

export async function runMonthlyReport(trigger: Pick<Actor, "id" | "name" | "role"> = SYSTEM, now = new Date()) {
  scanAlerts(now.getTime());
  const store = getStore();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const event = `monthly-report:${month}`;
  const audience = digestAudience((actor) => actor.permissions.includes("reports.inventory") && !isOutletScoped(actor.role));
  const kinds = Object.keys(INVENTORY_REPORTS) as InventoryReportKind[];
  let sent = 0;
  let alreadySent = 0;

  for (const recipient of audience) {
    if (store.deliveries.some((delivery) => delivery.recipientId === recipient.id && delivery.event === event && delivery.channel === "IN_APP")) {
      alreadySent += 1;
      continue;
    }
    const actor = { ...recipient, outletId: null };
    const reports = kinds.map((kind) => buildInventoryReport(actor, kind, {}));
    const workbook = await inventoryReportsExcel(reports);
    const title = `Monthly stock monitoring report · ${month}`;
    const body = reports.map((report) => `• ${report.title}: ${report.rows.length} line(s)`).join("\n");
    store.notifications.unshift({ id: `ntf-${nextNumber("notification")}`, userId: recipient.id, title, body, severity: "info", link: "/alerts?tab=reports", createdAt: new Date().toISOString() });
    log(recipient, "IN_APP", title, event, "SENT", "Shown in notification centre");
    const email = await sendEmail({
      to: recipient.email,
      subject: `[Pharmacy ERP] ${title}`,
      text: `${title}\n\n${body}\n\nThe full workbook is attached.`,
      attachments: [{ filename: `stock-monitoring-${month}.xlsx`, content: workbook, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
    });
    log(recipient, "EMAIL", title, event, email.status, email.detail);
    sent += 1;
  }
  store.jobRuns.monthly = month;
  recordAudit(trigger, { action: "alerts.monthly-report", entity: "Job", entityId: event, summary: `Monthly stock monitoring report sent to ${sent} recipient(s)${alreadySent ? `; ${alreadySent} already received this month's report` : ""}` });
  return { job: "monthly", month, recipients: sent, alreadySent };
}

/** Called every minute by the scheduler: rescan alerts and run due jobs once per day / month. */
export async function schedulerTick(now = new Date()) {
  scanAlerts(now.getTime());
  await processEmailRetries();
  const store = getStore();
  if (store.settings.alertEmail.dailySummary && now.getHours() >= store.settings.dailySummaryHour && store.jobRuns.daily !== localDate(now)) await runDailySummary(SYSTEM, now);
  // Monthly report goes out on the 1st (after the daily summary hour). Use the jobs API from an external cron to catch up if the server was down.
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (now.getDate() === 1 && store.jobRuns.monthly !== month && now.getHours() >= store.settings.dailySummaryHour) await runMonthlyReport(SYSTEM, now);
}
