// Background work (alert scans, digests, email retries) runs once per active pharmacy, each inside its own
// tenant transaction, so a job only ever sees and writes one pharmacy's data.
import { randomUUID } from "node:crypto";

import { initDatabase, platformQuery, withDatabaseTransaction } from "@/lib/db/database";
import { runInTenant } from "@/lib/saas/tenant";

export async function activeTenantIds(connectionString?: string) {
  await initDatabase(connectionString);
  const rows = await platformQuery<Array<{ id: string }>>((query) => query<{ id: string }>(`SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY created_at, id`));
  return rows.map((row) => row.id);
}

export type TenantJobResult<T> = { tenantId: string; ok: true; result: T } | { tenantId: string; ok: false; error: string };

/**
 * Runs job for every active pharmacy in turn. One pharmacy's failure is reported and does not stop the others.
 * Each run is recorded in platform_job_runs (shown on the Control Centre dashboard).
 */
export async function forEachTenant<T>(job: (tenantId: string) => Promise<T> | T, connectionString?: string, meta: { name?: string; trigger?: string } = {}): Promise<TenantJobResult<T>[]> {
  const results: TenantJobResult<T>[] = [];
  const tenants = await activeTenantIds(connectionString);
  const runId = `job-${randomUUID()}`;
  if (await switchedOff("alertJobs", meta.name ?? "alert-jobs", meta.trigger ?? "scheduler", runId)) return results;
  await platformQuery((query) => query(`INSERT INTO platform_job_runs (id, job, trigger, pharmacies) VALUES ($1, $2, $3, $4)`, [runId, meta.name ?? "alert-jobs", meta.trigger ?? "scheduler", tenants.length])).catch(() => undefined);
  for (const tenantId of tenants) {
    try {
      const result = await runInTenant(tenantId, () => withDatabaseTransaction(() => job(tenantId), connectionString));
      results.push({ tenantId, ok: true, result });
    } catch (error) {
      console.error(`[jobs] ${tenantId} failed`, error);
      results.push({ tenantId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const failed = results.filter((entry) => !entry.ok);
  await platformQuery((query) =>
    query(`UPDATE platform_job_runs SET finished_at = now(), failed = $1, detail = $2 WHERE id = $3`, [failed.length, failed.length ? `Failed for ${failed.map((entry) => entry.tenantId).join(", ")}`.slice(0, 500) : "All pharmacies done", runId]),
  ).catch(() => undefined);
  return results;
}

/** Platform-level jobs (not per pharmacy): the email retry queue. Recorded like the pharmacy jobs. */
export async function runPlatformJobs(trigger: string, connectionString?: string) {
  await initDatabase(connectionString);
  const runId = `job-${randomUUID()}`;
  if (await switchedOff("emailQueue", "email-queue", trigger, runId)) return { due: 0, sent: 0, skipped: true };
  await platformQuery((query) => query(`INSERT INTO platform_job_runs (id, job, trigger) VALUES ($1, 'email-queue', $2)`, [runId, trigger])).catch(() => undefined);
  try {
    const { processEmailQueue } = await import("@/lib/notify/email");
    const result = await processEmailQueue();
    // WhatsApp: renewal reminders are queued once per period; then due messages are sent.
    const { processWhatsAppQueue, queueRenewalReminders } = await import("@/lib/notify/whatsapp/service");
    const reminders = await queueRenewalReminders().catch((error) => { console.error("[whatsapp] renewal reminders", error instanceof Error ? error.message : "error"); return 0; });
    const whatsapp = await processWhatsAppQueue().catch((error) => { console.error("[whatsapp] queue", error instanceof Error ? error.message : "error"); return { due: 0 }; });
    // AI Wallet: settle interrupted holds, re-check pending coin payments, compare balances with the ledger.
    const { reconcileAi } = await import("@/lib/ai/reconcile");
    const ai = await reconcileAi(`job:${trigger}`, { minIntervalMinutes: trigger === "manual" ? 0 : 10 }).catch((error) => { console.error("[ai-wallet] reconciliation", error instanceof Error ? error.message : "error"); return null; });
    const aiDetail = ai ? `; AI wallets ${ai.walletsChecked} checked, ${ai.mismatches.length} difference(s), ${ai.actions.length} action(s)` : "";
    const whatsappDetail = whatsapp.due || reminders ? `; WhatsApp ${whatsapp.due} due${"SENT" in whatsapp ? `, ${whatsapp.SENT} sent` : ""}${reminders ? `, ${reminders} renewal reminder(s) queued` : ""}` : "";
    await platformQuery((query) => query(`UPDATE platform_job_runs SET finished_at = now(), detail = $1 WHERE id = $2`, [`${result.due} due, ${result.sent} sent${whatsappDetail}${aiDetail}`, runId])).catch(() => undefined);
    return result;
  } catch (error) {
    await platformQuery((query) => query(`UPDATE platform_job_runs SET finished_at = now(), failed = 1, detail = $1 WHERE id = $2`, [`Failed: ${error instanceof Error ? error.message : "error"}`.slice(0, 300), runId])).catch(() => undefined);
    throw error;
  }
}

/**
 * Scheduled runs of a job switched off in Control Centre → System are skipped (and recorded as skipped, so the
 * monitor shows why nothing ran). A run started by hand from the Control Centre ("manual") always runs.
 */
async function switchedOff(key: "alertJobs" | "emailQueue", job: string, trigger: string, runId: string) {
  if (trigger === "manual") return false;
  const { systemConfig } = await import("@/lib/platform/system");
  if ((await systemConfig()).jobs[key]) return false;
  await platformQuery((query) => query(`INSERT INTO platform_job_runs (id, job, trigger, finished_at, detail) VALUES ($1, $2, $3, now(), 'Skipped: turned off in Control Centre → System')`, [runId, job, trigger])).catch(() => undefined);
  return true;
}
