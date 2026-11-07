// Storage for uploaded regulatory documents.
// - Cloudflare Workers (and `next dev` with the Wrangler bindings): R2 bucket `REGULATORY_DOCS_BUCKET`.
// - Elsewhere (e.g. Vercel): the `regulatory_files` PostgreSQL table, written in the same transaction
//   as the document record, so an upload and its record commit or roll back together.
// Set DOCUMENT_STORAGE=postgres to force the database store.

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { onDatabaseRollback, runSql } from "@/lib/db/database";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/saas/tenant";

/**
 * R2 object key: every pharmacy's files live under its own prefix. Files the demo pharmacy uploaded before
 * multi-tenancy have no prefix and are still found under their old key.
 */
function objectKeys(name: string) {
  const tenantId = currentTenantId();
  const key = `${tenantId}/${name}`;
  return { key, candidates: tenantId === DEFAULT_TENANT_ID ? [key, name] : [key] };
}

export type DocumentStore = {
  kind: "r2" | "postgres";
  put(name: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(name: string): Promise<Uint8Array | null>;
  delete(name: string): Promise<void>;
};

async function r2Bucket() {
  if (process.env.DOCUMENT_STORAGE === "postgres") return null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env.REGULATORY_DOCS_BUCKET ?? null;
  } catch {
    return null; // not running with Cloudflare bindings
  }
}

export async function documentStore(): Promise<DocumentStore> {
  const bucket = await r2Bucket();
  if (bucket) {
    return {
      kind: "r2",
      async put(name, bytes, mimeType) {
        const { key } = objectKeys(name);
        // R2 is outside the database transaction: remove the object again if the transaction rolls back.
        onDatabaseRollback(() => bucket.delete(key));
        await bucket.put(key, bytes, { httpMetadata: { contentType: mimeType } });
      },
      async get(name) {
        for (const key of objectKeys(name).candidates) {
          const object = await bucket.get(key);
          if (object) return new Uint8Array(await object.arrayBuffer());
        }
        return null;
      },
      async delete(name) {
        for (const key of objectKeys(name).candidates) {
          const object = await bucket.get(key);
          if (!object) continue;
          const bytes = await object.arrayBuffer();
          const contentType = object.httpMetadata?.contentType;
          onDatabaseRollback(() => bucket.put(key, bytes, { httpMetadata: { contentType } }).then(() => undefined));
          await bucket.delete(key);
          return;
        }
      },
    };
  }
  return {
    kind: "postgres",
    // Every file row is owned by the current tenant; reads and deletes only match that tenant's files.
    async put(name, bytes, mimeType) {
      await runSql(`INSERT INTO regulatory_files (tenant_id, stored_name, mime_type, bytes) VALUES ($1, $2, $3, $4)`, [currentTenantId(), name, mimeType, Buffer.from(bytes)]);
    },
    async get(name) {
      const [row] = await runSql<{ bytes: Uint8Array }>(`SELECT bytes FROM regulatory_files WHERE tenant_id = $1 AND stored_name = $2`, [currentTenantId(), name]);
      return row ? new Uint8Array(row.bytes) : null;
    },
    async delete(name) {
      await runSql(`DELETE FROM regulatory_files WHERE tenant_id = $1 AND stored_name = $2`, [currentTenantId(), name]);
    },
  };
}
