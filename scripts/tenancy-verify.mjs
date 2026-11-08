// Checks a database after the tenancy migration against the backup taken just before it:
// - every table still has the same number of rows (new tables excepted),
// - money and stock totals are unchanged,
// - every tenant-owned row has a tenant, every user has a membership, and no link crosses tenants.
// Exits with code 1 on any mismatch.
//
//   DATABASE_URL=postgresql://… node scripts/tenancy-verify.mjs --backup .data/backups/<dir>/backup.json
//   Remote databases also need --confirm-remote (read-only: the script only runs SELECTs).
import { readFileSync } from "node:fs";

import pg from "pg";

import { connectionFromEnv, parseArgs } from "./db-tools.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.backup) throw new Error("Pass --backup <backup.json> (the backup taken before the migration).");
const connectionString = connectionFromEnv(args);
const backup = JSON.parse(readFileSync(args.backup, "utf8"));
const before = backup.tables ?? backup;

const NEW_TABLES = new Set(["tenants", "tenant_memberships"]);
const IGNORED = new Set(["_prisma_migrations", "_local_migrations", "platform_backups"]) /* the backup itself adds a row here */;
const TOTALS = [
  ["sales", "total"], ["sales", "amount_paid"], ["sale_lines", "quantity"], ["payments", "amount"], ["expenses", "amount"],
  ["purchase_orders", "total"], ["batches", "available_quantity"], ["batches", "quantity_received"], ["stock_ledger", "base_quantity"],
  ["products", "stock"],
];

const client = new pg.Client({ connectionString });
await client.connect();
const problems = [];
const report = [];
const totals = [];
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tenantIds = (await client.query("SELECT id FROM tenants ORDER BY id")).rows.map((row) => row.id);
  const { rows: rlsRows } = await client.query("SELECT relname FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace");
  const rlsTables = new Set(rlsRows.map((row) => row.relname));

  // Runs a query once per tenant scope when the table has RLS, and adds up the numeric results.
  async function scalar(table, sql) {
    if (!rlsTables.has(table)) return Number((await client.query(sql)).rows[0].value ?? 0);
    // Filter explicitly as well: a superuser (or table owner with BYPASSRLS) is not limited by the policies,
    // and app_state shows the shared '_platform' rows in every scope. Each scope's own rows are counted once.
    const scoped = `${sql} WHERE tenant_id = current_setting('app.tenant_id', true)`;
    let sum = 0;
    for (const tenantId of table === "app_state" ? [...tenantIds, "_platform"] : tenantIds) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      sum += Number((await client.query(scoped)).rows[0].value ?? 0);
    }
    return sum;
  }

  const { rows: tableRows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
  for (const { table_name: table } of tableRows) {
    if (IGNORED.has(table)) continue;
    const now = await scalar(table, `SELECT count(*) AS value FROM "${table}"`);
    if (NEW_TABLES.has(table) || !(table in before)) { // created by a migration after the backup
      report.push({ table, before: "(new)", after: now, status: "new" });
      continue;
    }
    const was = before[table]?.length;
    const ok = was === now;
    if (!ok) problems.push(`${table}: ${was} rows before, ${now} after`);
    report.push({ table, before: was ?? "(missing)", after: now, status: ok ? "ok" : "MISMATCH" });
  }

  for (const [table, column] of TOTALS) {
    if (!before[table]) continue;
    const was = before[table].reduce((sum, row) => sum + Number(row[column] ?? 0), 0);
    const now = await scalar(table, `SELECT COALESCE(sum("${column}"), 0) AS value FROM "${table}"`);
    const ok = Math.abs(was - now) < 0.0001;
    if (!ok) problems.push(`${table}.${column}: total ${was} before, ${now} after`);
    totals.push({ total: `${table}.${column}`, before: was, after: now, status: ok ? "ok" : "MISMATCH" });
  }

  // Integrity checks that need no backup.
  const integrity = [
    ["users without a membership", `SELECT count(*) AS value FROM users u WHERE NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id)`, "users"],
    ["memberships pointing at a missing tenant", `SELECT count(*) AS value FROM tenant_memberships m WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = m.tenant_id)`, "tenant_memberships"],
  ];
  for (const [label, sql, table] of integrity) {
    const value = await scalar(table, sql);
    if (value) problems.push(`${label}: ${value}`);
    totals.push({ total: label, before: "", after: value, status: value ? "PROBLEM" : "ok" });
  }
  await client.query("COMMIT");
} finally {
  await client.end();
}

console.log("\nRow counts");
console.table(report);
console.log("Totals and integrity");
console.table(totals);
if (problems.length) {
  console.error(`\n✖ ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("\n✔ Every table, total and link matches the pre-migration backup.");
