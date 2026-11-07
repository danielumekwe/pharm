// Starts the production build (`next start`) with a fresh embedded PostgreSQL database.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function startServer(extraEnv = {}) {
  if (process.env.TEST_RUNTIME !== "worker" && !existsSync(path.join(ROOT, ".next", "BUILD_ID"))) throw new Error("No production build found. Run `npm run build` first (or `npm run test:ci`).");
  const dir = mkdtempSync(path.join(tmpdir(), "pharmerp-test-"));
  const database = await PGlite.create(path.join(dir, "postgres"));
  const postgres = new PGLiteSocketServer({ db: database, port: 0, host: "127.0.0.1", maxConnections: 8 });
  await postgres.start();
  const connectionString = `postgresql://postgres:postgres@${postgres.getServerConn()}/postgres`;
  const queryClient = new pg.Client({ connectionString });
  await queryClient.connect();
  // Apply every migration in order, exactly as `prisma migrate deploy` would.
  const migrationsDir = path.join(ROOT, "prisma", "migrations");
  for (const name of readdirSync(migrationsDir).filter((entry) => !entry.endsWith(".toml")).sort()) {
    await queryClient.query(readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
  }
  // The app runs as the restricted role, so Row Level Security applies to every query it makes in tests.
  await queryClient.query(readFileSync(path.join(ROOT, "prisma", "sql", "app-role.sql"), "utf8"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const appEnv = {
    SEED_DEMO_DATA: "1",
    NEXTAUTH_URL: baseUrl,
    APP_URL: baseUrl,
    NEXTAUTH_SECRET: "test-secret-not-for-production",
    EMAIL_TRANSPORT: "json",
    ALERT_SCHEDULER: "off",
    DATABASE_APP_ROLE: "pharm_app",
    RATE_LIMIT: "off", // tests sign in many times from one address; tests/tenant-isolation.test.mjs turns it on
    EMAIL_OUTBOX_DIR: dir,
    SETTINGS_ENCRYPTION_KEY: "test-only-settings-encryption-key-0123456789", // JSON-transport emails are also written here, so tests can follow their links
    ...extraEnv,
  };
  // TEST_RUNTIME=worker runs the same tests against the OpenNext Worker inside workerd (`wrangler dev`),
  // connected to PostgreSQL through the local Hyperdrive binding. Requires `npm run cf-build:local` first.
  const worker = process.env.TEST_RUNTIME === "worker";
  if (worker && !existsSync(path.join(ROOT, ".open-next", "worker.js"))) throw new Error("No Worker build found. Run `npm run cf-build:local` first.");
  const child = worker
    ? spawn(
        process.execPath,
        [
          path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
          "dev",
          "--port", String(port),
          "--ip", "127.0.0.1",
          "--persist-to", path.join(dir, "wrangler-state"),
          "--inspector-port", String(await freePort()),
          ...Object.entries(appEnv).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
        ],
        {
          cwd: ROOT,
          detached: true,
          env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: connectionString, WRANGLER_SEND_METRICS: "false" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    : spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
        cwd: ROOT,
        detached: true, // own process group, so teardown stops only this server
        env: { ...process.env, NODE_ENV: "production", DATABASE_URL: connectionString, ...appEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));

  const deadline = Date.now() + (worker ? 240_000 : 60_000);
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) break;
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) throw new Error(`Server did not start in time:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return {
    baseUrl,
    logs: () => output,
    /** Emails "sent" so far (JSON transport), oldest first. */
    outbox() {
      const file = path.join(dir, "outbox.jsonl");
      return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    },
    /** Read-only assertions against persisted PostgreSQL rows. */
    async query(sql, ...params) {
      let index = 0;
      const statement = sql.replace(/\?/g, () => `$${++index}`);
      const result = await queryClient.query(statement, params);
      return result.rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "string" && [20, 21, 23, 700, 701, 1700].includes(result.fields.find((field) => field.name === key)?.dataTypeID)
              ? Number(value)
              : value,
          ]),
        ),
      );
    },
    async stop() {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already stopped
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      await queryClient.end();
      await postgres.stop();
      await database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
