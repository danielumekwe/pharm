// System configuration (Control Centre → System): maintenance mode, registration and trial switches,
// platform-wide feature switches, upload limits, background job switches; and the system's version, health,
// database size and backup history.
import { randomUUID } from "node:crypto";

import packageJson from "@/package.json";
import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { readPlatformSetting, SETTINGS, type SettingValue } from "@/lib/platform/settings";

export type SystemConfig = SettingValue<"system.config">;

/** Read fresh on every use: a change made on one server instance applies everywhere at once. */
export async function systemConfig(): Promise<SystemConfig> {
  try {
    return (await readPlatformSetting("system.config")).value;
  } catch {
    return SETTINGS["system.config"].defaults as SystemConfig;
  }
}

export const DEFAULT_MAINTENANCE_MESSAGE = "Pharmacy ERP is being updated. Please try again shortly.";

export class MaintenanceError extends DomainError {
  constructor(message: string) {
    super(message || DEFAULT_MAINTENANCE_MESSAGE, 503);
    this.name = "MaintenanceError";
  }
}

/** For pharmacy sign-in, pages and APIs. The Control Centre is never paused. */
export async function maintenanceMessage(): Promise<string | null> {
  const config = await systemConfig();
  return config.maintenance ? config.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE : null;
}

export async function assertNotInMaintenance() {
  const message = await maintenanceMessage();
  if (message) throw new MaintenanceError(message);
}

export const FEATURE_LABELS = { stock_transfers: "Stock transfers", regulatory_management: "Regulatory management" } as const;

/** Platform-wide switch for a feature (off overrides every plan). */
export async function assertFeatureSwitchedOn(feature: string) {
  const config = await systemConfig();
  if (feature in config.features && !config.features[feature as keyof SystemConfig["features"]]) {
    throw new DomainError(`${FEATURE_LABELS[feature as keyof typeof FEATURE_LABELS] ?? feature} is temporarily turned off by Web365.`, 403);
  }
}

const MIME = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" } as const;
/** Regulatory document upload rules in force. */
export async function documentUploadRules() {
  const config = await systemConfig();
  return { maxBytes: config.maxDocumentMB * 1024 * 1024, maxLabel: `${config.maxDocumentMB} MB`, mimeTypes: config.documentTypes.map((type) => MIME[type]) as string[], labels: config.documentTypes.map((type) => type.toUpperCase()) };
}

export async function logoUploadLimit() {
  const config = await systemConfig();
  return { maxBytes: config.maxLogoKB * 1024, maxLabel: config.maxLogoKB >= 1024 ? `${(config.maxLogoKB / 1024).toFixed(1).replace(/\.0$/, "")} MB` : `${config.maxLogoKB} KB` };
}

// ── System information ───────────────────────────────────────────────────────────────────────────────────

const startedAt = new Date();

export async function systemInfo() {
  const [database] = await platformQuery<Array<{ version: string; size: string; now: Date }>>((query) =>
    query(`SELECT current_setting('server_version') AS version, pg_database_size(current_database()) AS size, now() AS now`),
  );
  const tables = await platformQuery<Array<{ name: string; bytes: string; rows: string }>>((query) =>
    query(
      `SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes, greatest(c.reltuples, 0)::bigint AS rows
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`,
    ),
  );
  const migrations = await platformQuery<Array<{ name: string; at: Date | null }>>(async (query) => {
    const [prisma] = await query<{ present: boolean }>(`SELECT to_regclass('_prisma_migrations') IS NOT NULL AS present`);
    if (prisma?.present) return query(`SELECT migration_name AS name, finished_at AS at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 8`);
    const [local] = await query<{ present: boolean }>(`SELECT to_regclass('_local_migrations') IS NOT NULL AS present`);
    return local?.present ? query(`SELECT name, applied_at AS at FROM _local_migrations ORDER BY name DESC LIMIT 8`) : [];
  });
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? process.env.GIT_COMMIT ?? null;
  return {
    version: packageJson.version,
    commit: commit ? commit.slice(0, 12) : null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    runtime: typeof process.versions?.node === "string" ? `Node.js ${process.versions.node}` : "unknown",
    startedAt: startedAt.toISOString(),
    database: { version: database?.version ?? "?", sizeBytes: Number(database?.size ?? 0), clock: database?.now ? new Date(database.now).toISOString() : null },
    tables: tables.map((row) => ({ name: row.name, bytes: Number(row.bytes), rows: Number(row.rows) })),
    migrations: migrations.map((row) => ({ name: row.name, at: row.at ? new Date(row.at).toISOString() : null })),
    latestMigration: migrations[0]?.name ?? null,
  };
}

// ── Backups ──────────────────────────────────────────────────────────────────────────────────────────────

export async function backupHistory() {
  const rows = await platformQuery<Array<{ id: string; taken_at: Date; kind: string; label: string; tables: number | null; rows: string | null; size_bytes: string | null; location: string | null; recorded_by: string; note: string | null }>>((query) =>
    query(`SELECT * FROM platform_backups ORDER BY taken_at DESC LIMIT 50`),
  );
  return rows.map((row) => ({ ...row, taken_at: new Date(row.taken_at).toISOString(), rows: row.rows === null ? null : Number(row.rows), size_bytes: row.size_bytes === null ? null : Number(row.size_bytes) }));
}

/** Notes a backup made outside this app (e.g. a Neon branch or snapshot), so the history is complete. */
export async function recordProviderBackup(actor: PlatformActor, input: { label: string; takenAt: string; location: string; note: string }) {
  const taken = new Date(input.takenAt);
  if (Number.isNaN(taken.getTime()) || taken.getTime() > Date.now() + 60_000) throw new DomainError("Enter when the backup was taken (not in the future).");
  if (input.label.trim().length < 3) throw new DomainError("Give the backup a name.");
  const id = `bkp-${randomUUID()}`;
  await platformQuery((query) =>
    query(`INSERT INTO platform_backups (id, taken_at, kind, label, location, recorded_by, note) VALUES ($1, $2, 'provider', $3, $4, $5, $6)`, [id, taken, input.label.trim(), input.location.trim() || null, actor.name, input.note.trim() || null]),
  );
  await recordPlatformAudit(platformActorRef(actor), { action: "system.backup-recorded", targetType: "Backup", targetId: id, summary: `Noted a provider backup "${input.label.trim()}" taken ${taken.toISOString().slice(0, 16).replace("T", " ")} UTC` });
  return { ok: true, id };
}

// ── Background jobs ──────────────────────────────────────────────────────────────────────────────────────

export async function jobHistory() {
  const rows = await platformQuery<Array<{ id: string; job: string; trigger: string; started_at: Date; finished_at: Date | null; pharmacies: number; failed: number; detail: string | null }>>((query) =>
    query(`SELECT id, job, trigger, started_at, finished_at, pharmacies, failed, detail FROM platform_job_runs ORDER BY started_at DESC LIMIT 60`),
  );
  return rows.map((row) => ({ ...row, started_at: new Date(row.started_at).toISOString(), finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null }));
}
