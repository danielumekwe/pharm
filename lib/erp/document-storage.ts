// Storage for uploaded regulatory documents.
// - Cloudflare Workers (and `next dev` with the Wrangler bindings): R2 bucket `REGULATORY_DOCS_BUCKET`.
// - Elsewhere (e.g. Vercel): the `regulatory_files` PostgreSQL table, written in the same transaction
//   as the document record, so an upload and its record commit or roll back together.
// Set DOCUMENT_STORAGE=postgres to force the database store.

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { onDatabaseRollback, runSql } from "@/lib/db/database";

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
        // R2 is outside the database transaction: remove the object again if the transaction rolls back.
        onDatabaseRollback(() => bucket.delete(name));
        await bucket.put(name, bytes, { httpMetadata: { contentType: mimeType } });
      },
      async get(name) {
        const object = await bucket.get(name);
        return object ? new Uint8Array(await object.arrayBuffer()) : null;
      },
      async delete(name) {
        const object = await bucket.get(name);
        if (!object) return;
        const bytes = await object.arrayBuffer();
        const contentType = object.httpMetadata?.contentType;
        onDatabaseRollback(() => bucket.put(name, bytes, { httpMetadata: { contentType } }).then(() => undefined));
        await bucket.delete(name);
      },
    };
  }
  return {
    kind: "postgres",
    async put(name, bytes, mimeType) {
      await runSql(`INSERT INTO regulatory_files (stored_name, mime_type, bytes) VALUES ($1, $2, $3)`, [name, mimeType, Buffer.from(bytes)]);
    },
    async get(name) {
      const [row] = await runSql<{ bytes: Uint8Array }>(`SELECT bytes FROM regulatory_files WHERE stored_name = $1`, [name]);
      return row ? new Uint8Array(row.bytes) : null;
    },
    async delete(name) {
      await runSql(`DELETE FROM regulatory_files WHERE stored_name = $1`, [name]);
    },
  };
}
