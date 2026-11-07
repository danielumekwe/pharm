// Restores a JSON backup made by scripts/db-backup.mjs (or the older flat {table: rows} format) into a
// database whose schema already matches the backup. Every listed table is emptied first, then refilled,
// in one transaction: either the whole restore lands or nothing changes.
//
//   DATABASE_URL=postgresql://… node scripts/db-restore.mjs --file .data/backups/<dir>/backup.json --confirm-overwrite
//   Remote databases (anything not on localhost) also need --confirm-remote.
//
// Tables the backup does not mention are left alone; migration bookkeeping tables are never touched.
import { readFileSync } from "node:fs";

import pg from "pg";

import { connectionFromEnv, parseArgs } from "./db-tools.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.file) throw new Error("Pass --file <backup.json>.");
if (!args["confirm-overwrite"]) throw new Error("A restore replaces the rows of every table in the backup. Pass --confirm-overwrite.");
const connectionString = connectionFromEnv(args);

const parsed = JSON.parse(readFileSync(args.file, "utf8"));
const tables = parsed.tables ?? parsed;
const SKIP = new Set(["_prisma_migrations", "_local_migrations"]);

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  // Foreign keys and triggers are not checked while rows go back in (needs a superuser or the table owner).
  await client.query("SET LOCAL session_replication_role = replica");
  const { rows: existing } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  const present = new Set(existing.map((row) => row.table_name));
  const { rows: rlsRows } = await client.query("SELECT relname FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace");
  const rlsTables = new Set(rlsRows.map((row) => row.relname));
  const tenantIds = present.has("tenants") ? [...new Set([...(tables.tenants ?? []).map((row) => row.id), "_platform"])] : [];

  const names = Object.keys(tables).filter((name) => !SKIP.has(name));
  for (const name of names) {
    if (!present.has(name)) throw new Error(`Table ${name} is in the backup but not in this database. Bring the schema to the backup's migration first.`);
  }
  for (const name of names) {
    if (rlsTables.has(name)) {
      for (const tenantId of tenantIds) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await client.query(`DELETE FROM "${name}"`);
      }
    } else {
      await client.query(`DELETE FROM "${name}"`);
    }
  }

  let restored = 0;
  for (const name of names) {
    const rows = tables[name];
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    for (const row of rows) {
      if (rlsTables.has(name)) await client.query("SELECT set_config('app.tenant_id', $1, true)", [row.tenant_id]);
      const values = columns.map((column) => {
        const value = row[column];
        if (value && typeof value === "object" && "$bytes" in value) return Buffer.from(value.$bytes, "base64");
        return value;
      });
      await client.query(
        `INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
        values,
      );
      restored += 1;
    }
    console.log(`  ${name}: ${rows.length}`);
  }
  await client.query("COMMIT");
  console.log(`Restored ${restored} rows into ${names.length} tables.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
