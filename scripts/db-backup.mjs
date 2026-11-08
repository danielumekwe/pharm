// Full JSON backup of the PostgreSQL database (every table, every row), for use before migrations.
// No pg_dump needed. Output: .data/backups/<label>-<timestamp>/backup.json + manifest.json (row counts per table).
//
//   DATABASE_URL=postgresql://… node scripts/db-backup.mjs [--label pre-tenancy]
//   Remote databases (anything not on localhost) also need --confirm-remote.
//
// Works before and after the tenancy migration: with Row Level Security on, tenant tables are read one
// tenant at a time (app.tenant_id set per tenant), so the backup never needs a policy bypass.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";

import { connectionFromEnv, describeTarget, parseArgs } from "./db-tools.mjs";

const args = parseArgs(process.argv.slice(2));
const connectionString = connectionFromEnv(args);
const client = new pg.Client({ connectionString });
await client.connect();

const label = String(args.label ?? "backup").replace(/[^a-z0-9-]/gi, "-");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(args.out ?? path.join(".data", "backups", `${label}-${stamp}`));

try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); // one consistent snapshot
  const { rows: tableRows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const { rows: rlsRows } = await client.query("SELECT relname FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace");
  const rlsTables = new Set(rlsRows.map((row) => row.relname));
  const hasTenants = tableRows.some((row) => row.table_name === "tenants");
  const tenantIds = hasTenants ? (await client.query("SELECT id FROM tenants ORDER BY id")).rows.map((row) => row.id) : [];

  const tables = {};
  const counts = {};
  for (const { table_name: table } of tableRows) {
    let rows;
    if (rlsTables.has(table)) {
      rows = [];
      const seen = new Set();
      for (const tenantId of [...tenantIds, "_platform"]) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        for (const row of (await client.query(`SELECT * FROM "${table}"`)).rows) {
          const key = JSON.stringify(row); // app_state platform rows are visible under every tenant
          if (!seen.has(key)) {
            seen.add(key);
            rows.push(row);
          }
        }
      }
    } else {
      rows = (await client.query(`SELECT * FROM "${table}"`)).rows;
    }
    tables[table] = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Buffer.isBuffer(value) ? { $bytes: value.toString("base64") } : value])));
    counts[table] = rows.length;
  }
  await client.query("COMMIT");

  const migrations = tables._prisma_migrations?.map((row) => row.migration_name) ?? tables._local_migrations?.map((row) => row.name) ?? [];
  const manifest = { createdAt: new Date().toISOString(), target: describeTarget(connectionString), migrations, counts };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "backup.json"), JSON.stringify({ meta: manifest, tables }));
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Backup written to ${outDir}`);
  // Noted in the backup history the Control Centre shows (after the snapshot, so not part of it). --no-record skips it.
  if (!args["no-record"] && tableRows.some((row) => row.table_name === "platform_backups")) {
    const size = Buffer.byteLength(JSON.stringify({ meta: manifest, tables }));
    await client.query(
      `INSERT INTO platform_backups (id, kind, label, tables, rows, size_bytes, location, recorded_by) VALUES ($1, 'script', $2, $3, $4, $5, $6, $7)`,
      [`bkp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, label, Object.keys(counts).length, Object.values(counts).reduce((sum, count) => sum + count, 0), size, path.relative(process.cwd(), outDir), `db-backup (${process.env.USER ?? "unknown user"})`],
    ).then(() => console.log("Recorded in the Control Centre backup history.")).catch((error) => console.warn(`Not recorded in the backup history: ${error.message}`));
  }
  console.log(`${Object.keys(counts).length} tables, ${Object.values(counts).reduce((sum, count) => sum + count, 0)} rows.`);
} finally {
  await client.end();
}
