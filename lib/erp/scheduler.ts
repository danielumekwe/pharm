// In-process scheduler for alert scans and digests. One instance per server process.
// For multi-instance deployments, disable with ALERT_SCHEDULER=off and call POST /api/alerts/jobs from an external cron.

import { schedulerTick } from "@/lib/erp/alert-jobs";
import { forEachTenant } from "@/lib/saas/jobs";

const registry = globalThis as typeof globalThis & { __pharmScheduler?: ReturnType<typeof setInterval> };

export function startScheduler() {
  if (registry.__pharmScheduler || process.env.ALERT_SCHEDULER === "off") return;
  // One pass per active pharmacy, each in its own tenant transaction.
  const tick = () => forEachTenant(() => schedulerTick()).catch((error) => console.error("[alerts] scheduler tick failed", error));
  setTimeout(tick, 15_000);
  registry.__pharmScheduler = setInterval(tick, 60_000);
  registry.__pharmScheduler.unref?.();
}
