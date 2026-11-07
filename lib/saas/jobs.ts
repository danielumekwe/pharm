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
