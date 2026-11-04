// Local PostgreSQL for development and Worker previews, without installing Postgres.
// Runs an embedded PGlite database behind the Postgres wire protocol and applies the Prisma migrations.
//
//   npm run db:local                       # postgresql://postgres:postgres@127.0.0.1:5432/postgres, data in .data/pglite
//   PGLITE_PORT=55432 PGLITE_DIR=/tmp/x npm run db:local
//
// Point DATABASE_URL (next dev) or CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE (wrangler dev) at it.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const ROOT = path.resolve(import.meta.dirname, "..");
const dir = path.resolve(process.env.PGLITE_DIR ?? path.join(ROOT, ".data", "pglite"));
const port = Number(process.env.PGLITE_PORT ?? 5432);
const fresh = !existsSync(dir);
mkdirSync(dir, { recursive: true });

const database = await PGlite.create(dir);
await database.exec(`CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
const applied = new Set((await database.query("SELECT name FROM _local_migrations")).rows.map((row) => row.name));
const migrationsDir = path.join(ROOT, "prisma", "migrations");
for (const name of readdirSync(migrationsDir).filter((entry) => !entry.endsWith(".toml")).sort()) {
  if (applied.has(name)) continue;
  await database.exec(readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
  await database.query("INSERT INTO _local_migrations (name) VALUES ($1)", [name]);
  console.log(`[pglite] applied migration ${name}`);
}

const server = new PGLiteSocketServer({ db: database, port, host: "127.0.0.1", maxConnections: 16 });
await server.start();
console.log(`[pglite] ${fresh ? "created" : "opened"} ${dir}`);
console.log(`[pglite] listening: postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);

const stop = async () => {
  await server.stop();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
