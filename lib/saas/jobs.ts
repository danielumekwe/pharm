// Background work (alert scans, digests, email retries) runs once per active pharmacy, each inside its own
// tenant transaction, so a job only ever sees and writes one pharmacy's data.
import { initDatabase, platformQuery, withDatabaseTransaction } from "@/lib/db/database";
import { runInTenant } from "@/lib/saas/tenant";

export async function activeTenantIds(connectionString?: string) {
  await initDatabase(connectionString);
  const rows = await platformQuery<Array<{ id: string }>>((query) => query<{ id: string }>(`SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY created_at, id`));
  return rows.map((row) => row.id);
}

export type TenantJobResult<T> = { tenantId: string; ok: true; result: T } | { tenantId: string; ok: false; error: string };

/** Runs job for every active pharmacy in turn. One pharmacy's failure is reported and does not stop the others. */
export async function forEachTenant<T>(job: (tenantId: string) => Promise<T> | T, connectionString?: string): Promise<TenantJobResult<T>[]> {
  const results: TenantJobResult<T>[] = [];
  for (const tenantId of await activeTenantIds(connectionString)) {
    try {
      const result = await runInTenant(tenantId, () => withDatabaseTransaction(() => job(tenantId), connectionString));
      results.push({ tenantId, ok: true, result });
    } catch (error) {
      console.error(`[jobs] ${tenantId} failed`, error);
      results.push({ tenantId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
