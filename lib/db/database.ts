import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { DATA_VERSION } from "@/lib/data-version";
import { columnName, KV_TABLE, TABLES, type ChildSpec, type FieldSpec, type TableSpec } from "@/lib/db/schema";
import { requestTenantId } from "@/lib/saas/request-tenant";
import { DEFAULT_TENANT_ID, membershipId, PLATFORM_SCOPE, PLATFORM_STATE_KEYS, runInTenant, scopedTenantId, TenantRequiredError } from "@/lib/saas/tenant";

// PostgreSQL allows 65,535 bind parameters per statement; stay well below it.
const MAX_BIND_PARAMETERS = 30_000;

type Row = Record<string, unknown>;
type Registry = typeof globalThis & Record<string, unknown> & {
  __pharmDb?: PharmDb;
  __pharmDbInit?: Promise<"loaded" | "seeded">;
  __pharmTransactions?: AsyncLocalStorage<Transaction>;
  __pharmRollbackActions?: AsyncLocalStorage<Array<() => Promise<void> | void>>;
  __pharmPending?: AsyncLocalStorage<Promise<unknown>[]>;
  __pharmTxTenant?: AsyncLocalStorage<TenantContext>;
  __pharmInternalAccess?: AsyncLocalStorage<boolean>;
  __pharmWorkingSetGuard?: () => boolean;
};
/** The tenant a transaction runs for (null: an anonymous request, which sees no tenant data). */
export type TenantInfo = { id: string; name: string; status: string; isDemo: boolean };
/** "refuse": a change fails the request (API actions). "discard": incidental changes are dropped (page views). */
type ReadOnlyMode = "refuse" | "discard";
type TenantContext = { tenantId: string | null; tenant: TenantInfo | null; readOnly?: ReadOnlyMode };
type Transaction = Prisma.TransactionClient;
type Collections = {
  tables: Record<string, Row[]>;
  kv: Record<string, unknown>;
};

const LOCK_KEY = "__pharm_write_lock";
const STORE_KEY = `__pharmErpStore_v${DATA_VERSION}`;
const DATA_KEY = (key: string) => `__pharm_v${DATA_VERSION}_${key}`;
const MATRIX_KEY = `__pharm_rolePermissions_v${DATA_VERSION}`;
const registry = globalThis as Registry;
const transactions = registry.__pharmTransactions ??= new AsyncLocalStorage<Transaction>();
const rollbackActions = registry.__pharmRollbackActions ??= new AsyncLocalStorage<Array<() => Promise<void> | void>>();
const pendingWork = registry.__pharmPending ??= new AsyncLocalStorage<Promise<unknown>[]>();
const txTenant = registry.__pharmTxTenant ??= new AsyncLocalStorage<TenantContext>();
const internalAccess = registry.__pharmInternalAccess ??= new AsyncLocalStorage<boolean>();

// The in-memory working set holds ONE tenant's data at a time, and only while that tenant's transaction runs.
// lib/data.ts and lib/erp/store.ts call this guard on every read, so code that reads it outside a
// transaction (where it could belong to another tenant's request) fails loudly instead of leaking.
registry.__pharmWorkingSetGuard = () => Boolean(transactions.getStore()) || internalAccess.getStore() === true;

/** For the persistence layer itself (load, flush, first-run seeding), which works on the raw working set. */
function internal<T>(fn: () => T): T {
  return internalAccess.run(true, fn);
}

/** Users' role, status, grants, default outlet and staff ID are per tenant: they live on tenant_memberships. */
const MEMBERSHIP_COLUMNS: Record<string, string> = { role: "role", status: "status", grants: "grants", outlet_id: "default_outlet_id", staff_id: "staff_id" };

/**
 * Optional database role the app switches to inside every transaction (SET LOCAL ROLE). Use a role without
 * BYPASSRLS so Row Level Security also applies when the connection logs in as the table owner.
 */
function appRole() {
  const role = process.env.DATABASE_APP_ROLE?.trim();
  if (!role) return null;
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("DATABASE_APP_ROLE must be a plain lower-case role name.");
  return role;
}
function toDb(value: unknown, kind: FieldSpec[1]) {
  if (value === undefined || value === null) return null;
  if (kind === "json") return JSON.stringify(value);
  if (kind === "bool") return Boolean(value);
  if (kind === "int") return Math.round(Number(value));
  if (kind === "real" || kind === "money") return Number(value);
  return String(value);
}

function fromDb(value: unknown, kind: FieldSpec[1]) {
  if (value === null || value === undefined) return undefined;
  if (kind === "json") return JSON.parse(String(value));
  if (kind === "bool") return Boolean(value);
  if (kind === "int" || kind === "real" || kind === "money") return Number(value);
  return String(value);
}

function rowToObject(row: Row, fields: readonly FieldSpec[]) {
  const object: Row = {};
  for (const [field, kind] of fields) {
    const value = fromDb(row[columnName(field)], kind);
    if (value !== undefined) object[field] = value;
    else if (row[columnName(field)] === null && (field === "outletId" || field === "customerId" || field === "invite")) object[field] = null;
  }
  return object;
}

/** True inside Cloudflare's workerd runtime (deployed Worker or `wrangler dev`). */
function isWorkersRuntime() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/** On Workers the Hyperdrive connection string is read from the current request's bindings each time. */
async function currentConnectionString(fallback: string) {
  if (!isWorkersRuntime()) return fallback;
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env.HYPERDRIVE?.connectionString ?? fallback;
  } catch {
    return fallback; // scheduled handler passes the connection string explicitly
  }
}

function snapshotCollections(): Collections | null {
  const store = registry[STORE_KEY] as Record<string, unknown> | undefined;
  if (!store) return null;
  const tables: Record<string, Row[]> = {};
  for (const spec of TABLES) {
    const source = spec.source.kind === "data" ? registry[DATA_KEY(spec.source.key)] : store[spec.source.key];
    tables[spec.table] = Array.isArray(source) ? structuredClone(source as Row[]) : [];
  }
  return {
    tables,
    kv: structuredClone({
      settings: store.settings,
      counters: store.counters,
      jobRuns: store.jobRuns,
      rolePermissions: registry[MATRIX_KEY],
      dataVersion: DATA_VERSION,
    }),
  };
}

function restoreCollections(collections: Collections) {
  const store = registry[STORE_KEY] as Record<string, unknown>;
  for (const spec of TABLES) {
    const rows = collections.tables[spec.table] ?? [];
    if (spec.source.kind === "data") {
      const current = registry[DATA_KEY(spec.source.key)];
      if (Array.isArray(current)) current.splice(0, current.length, ...rows);
      else registry[DATA_KEY(spec.source.key)] = rows;
    } else {
      const current = store[spec.source.key];
      if (Array.isArray(current)) current.splice(0, current.length, ...rows);
      else store[spec.source.key] = rows;
    }
  }
  store.settings = collections.kv.settings;
  store.counters = collections.kv.counters ?? {};
  store.jobRuns = collections.kv.jobRuns ?? {};
  registry[MATRIX_KEY] = collections.kv.rolePermissions ?? undefined;
}

/** Global per-person tables (users, devices) are loaded for the tenant's members only. */
function isUserScoped(spec: TableSpec) {
  return spec.scope === "user";
}

/** Column that ties a user-scoped row to a person: users.id, devices.user_id. */
function memberColumn(spec: TableSpec) {
  return spec.table === "users" ? "id" : "user_id";
}

/**
 * Scopes this transaction to one tenant for PostgreSQL Row Level Security (reset when it ends). An empty
 * scope ("") matches no tenant rows. Also switches to the restricted app role when one is configured.
 */
// One queue per transaction connection, for work that must not interleave with other statements on it.
const connectionQueues = new WeakMap<object, Promise<unknown>>();
function serialised<T>(tx: object, work: () => Promise<T>): Promise<T> {
  const next = (connectionQueues.get(tx) ?? Promise.resolve()).then(work);
  connectionQueues.set(tx, next.catch(() => undefined));
  return next;
}

async function setTenantScope(tx: Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">, tenantId: string | null, { switchRole = true } = {}) {
  const role = switchRole ? appRole() : null;
  if (role) await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
  await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId ?? "");
}

export class ReadOnlyError extends Error {
  status = 403;
  constructor() {
    super("Read-only access: this session cannot change the pharmacy's records.");
    this.name = "ReadOnlyError";
  }
}

/**
 * Marks the running transaction read-only (Web365 support sessions): saving any change other than audit
 * entries (and the counters their IDs use) fails and the whole request is rolled back.
 */
export function markTransactionReadOnly(mode: ReadOnlyMode = "refuse") {
  const context = txTenant.getStore();
  if (!context) throw new Error("No transaction to mark read-only.");
  context.readOnly = mode;
}

/** The tenant of the transaction currently running, or null outside a transaction or for anonymous requests. */
export function currentTenant(): TenantInfo | null {
  return txTenant.getStore()?.tenant ?? null;
}

function replaceCollection(target: unknown, rows: Row[]) {
  if (!Array.isArray(target)) return rows;
  target.splice(0, target.length, ...rows);
  return target;
}

class PharmDb {
  /** Long-lived client for Node.js. On Workers a client is created per transaction instead (see below). */
  private readonly client: PrismaClient | null;
  private readonly connectionString: string;
  private snapshots = new Map<string, Map<string, string>>();
  private sequences = new Map<string, Map<string, number>>();
  private kvSnapshot = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlush: { at: string; changed: number; ms: number } | null = null;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    // Workers forbid reusing a socket opened by one request in another request, so a cached pool would
    // hang every request after the first. Hyperdrive pools the real database connections, so a fresh
    // client per transaction is the recommended pattern there.
    this.client = isWorkersRuntime() ? null : new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3 }) });
  }

  private async withClient<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
    if (this.client) return run(this.client);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: await currentConnectionString(this.connectionString), max: 1 }) });
    try {
      return await run(client);
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  }

  async transaction<T>(callback: (tx: Transaction) => Promise<T> | T): Promise<T> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const active = transactions.getStore();
    if (active) {
      // Nested calls join the running transaction, which must be for the same tenant.
      const requested = scopedTenantId();
      const running = txTenant.getStore();
      if (requested !== undefined && running && requested !== running.tenantId) {
        throw new Error("[db] a transaction for one pharmacy cannot run inside another pharmacy's transaction.");
      }
      return callback(active);
    }

    // The tenant comes from the server side only: an explicit scope (sign-in, jobs) or the signed session.
    const explicit = scopedTenantId();
    const tenantId = explicit !== undefined ? explicit : await requestTenantId();

    const actions: Array<() => Promise<void> | void> = [];
    let before: Collections | null = null;
    try {
      return await this.withClient((client) => client.$transaction(
        async (tx) => {
        await setTenantScope(tx, tenantId);
        await tx.$executeRawUnsafe(
          `INSERT INTO ${KV_TABLE} (tenant_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO NOTHING`,
          PLATFORM_SCOPE,
          LOCK_KEY,
          "{}",
        );
        await tx.$queryRawUnsafe(`SELECT key FROM ${KV_TABLE} WHERE tenant_id = $1 AND key = $2 FOR UPDATE`, PLATFORM_SCOPE, LOCK_KEY);
        let tenant: TenantInfo | null = null;
        if (tenantId) {
          const [row] = await tx.$queryRawUnsafe<{ id: string; name: string; status: string; is_demo: boolean }[]>(
            `SELECT id, name, status, is_demo FROM tenants WHERE id = $1`,
            tenantId,
          );
          if (!row) throw new TenantRequiredError("This pharmacy account does not exist.");
          tenant = { id: row.id, name: row.name, status: row.status, isDemo: Boolean(row.is_demo) };
        }
        await internal(() => this.load(tx, tenantId));
        before = snapshotCollections();
        const pending: Promise<unknown>[] = [];
        const context: TenantContext = { tenantId, tenant };
        const result = await runInTenant(tenantId, () => txTenant.run(context, () => transactions.run(tx, () => rollbackActions.run(actions, () => pendingWork.run(pending, async () => {
          const value = await callback(tx);
          // Side effects started during the request (e.g. alert notifications) finish before commit,
          // so their records are saved and Workers do not cancel them after the response.
          while (pending.length) await Promise.allSettled(pending.splice(0));
          return value;
        })))));
        await serialised(tx, () => internal(() => this.flush(tx, tenantId, context.readOnly)));
        return result;
        },
        { maxWait: 10_000, timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      ));
    } catch (error) {
      if (before) internal(() => restoreCollections(before as Collections));
      for (const action of actions.reverse()) {
        try {
          await action();
        } catch (cleanupError) {
          console.error("[db] rollback cleanup failed", cleanupError);
        }
      }
      throw error;
    }
  }

  private async loadTable(tx: Transaction, spec: TableSpec, tenantId: string | null) {
    if (!tenantId) {
      // Anonymous requests see no tenant data at all.
      this.sequences.set(spec.table, new Map());
      this.snapshots.set(spec.table, new Map());
      return [];
    }
    // Only this tenant's rows reach memory, so business logic cannot see another tenant's records.
    const order = `ORDER BY seq ${spec.order === "desc" ? "DESC" : "ASC"}`;
    let rows: Row[];
    if (spec.table === "users") {
      // Members only, with this tenant's role, status, grants, default outlet and staff ID.
      const overlay = Object.entries(MEMBERSHIP_COLUMNS).map(([column, source]) => `m.${source} AS m_${column}`).join(", ");
      rows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT u.*, ${overlay} FROM users u JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = $1 ${order.replace("seq", "u.seq")}`,
        tenantId,
      );
      for (const row of rows) for (const column of Object.keys(MEMBERSHIP_COLUMNS)) row[column] = row[`m_${column}`];
    } else {
      const filter = isUserScoped(spec)
        ? `${memberColumn(spec)} IN (SELECT user_id FROM tenant_memberships WHERE tenant_id = $1)`
        : "tenant_id = $1";
      rows = await tx.$queryRawUnsafe<Row[]>(`SELECT * FROM ${spec.table} WHERE ${filter} ${order}`, tenantId);
    }
    const sequences = new Map<string, number>();
    const snapshot = new Map<string, string>();
    const objects = rows.map((row) => {
      const object = rowToObject(row, spec.fields);
      sequences.set(String(row.id), Number(row.seq));
      return object;
    });

    for (const child of spec.children ?? []) {
      const childRows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT * FROM ${child.table} WHERE tenant_id = $1 ORDER BY ${child.parentColumn}, position`,
        tenantId,
      );
      const byParent = new Map<string, unknown[]>();
      for (const childRow of childRows) {
        const parentId = String(childRow[child.parentColumn]);
        const list = byParent.get(parentId) ?? [];
        list.push(child.scalarColumn ? String(childRow[child.scalarColumn]) : rowToObject(childRow, child.fields ?? []));
        byParent.set(parentId, list);
      }
      for (const object of objects) object[child.property] = byParent.get(String(object.id)) ?? [];
    }

    for (const object of objects) snapshot.set(String(object.id), JSON.stringify(object));
    this.sequences.set(spec.table, sequences);
    this.snapshots.set(spec.table, snapshot);
    return objects;
  }

  private async load(tx: Transaction, tenantId: string | null) {
    const { getStore } = await import("@/lib/erp/store");
    const store = getStore() as unknown as Record<string, unknown>;
    const kvRows = tenantId
      ? await tx.$queryRawUnsafe<{ key: string; value: string }[]>(`SELECT key, value FROM ${KV_TABLE} WHERE tenant_id = $1`, tenantId)
      : [];
    this.kvSnapshot.clear();
    const kv: Record<string, unknown> = {};
    for (const row of kvRows) {
      kv[row.key] = JSON.parse(row.value);
      this.kvSnapshot.set(row.key, row.value);
    }

    for (const spec of TABLES) {
      const rows = await this.loadTable(tx, spec, tenantId);
      if (spec.source.kind === "data") {
        const key = DATA_KEY(spec.source.key);
        registry[key] = replaceCollection(registry[key], rows);
      } else {
        store[spec.source.key] = replaceCollection(store[spec.source.key], rows);
      }
    }
    // A tenant without saved settings starts from the defaults (never from another tenant's settings).
    store.settings = kv.settings ?? undefined;
    store.counters = kv.counters ?? {};
    store.jobRuns = kv.jobRuns ?? {};
    // Each tenant has its own role matrix; without a saved one the defaults apply (never the previous tenant's).
    registry[MATRIX_KEY] = kv.rolePermissions ?? undefined;
    const { getStore: normalizeStore, ensureLedgerBaseline } = await import("@/lib/erp/store");
    // Databases created before the stock ledger get opening balances for existing batches (saved by this transaction).
    ensureLedgerBaseline(normalizeStore());
  }

  /** Writes many rows with as few round trips as possible: one multi-row INSERT per chunk. */
  private async insertRows(tx: Transaction, head: string, tail: string, rows: unknown[][]) {
    if (!rows.length) return 0;
    let affected = 0;
    const perChunk = Math.max(1, Math.floor(MAX_BIND_PARAMETERS / rows[0].length));
    for (let start = 0; start < rows.length; start += perChunk) {
      const parameters: unknown[] = [];
      const tuples = rows.slice(start, start + perChunk).map((row) => {
        const slots = row.map((value) => {
          parameters.push(value);
          return `$${parameters.length}`;
        });
        return `(${slots.join(", ")})`;
      });
      affected += await tx.$executeRawUnsafe(`${head} VALUES ${tuples.join(", ")}${tail}`, ...parameters);
    }
    return affected;
  }

  private async writeChildren(tx: Transaction, child: ChildSpec, parents: Array<[string, unknown[]]>, tenantId: string) {
    if (!parents.length) return;
    await tx.$executeRawUnsafe(
      `DELETE FROM ${child.table} WHERE ${child.parentColumn} = ANY($1::text[]) AND tenant_id = $2`,
      parents.map(([parentId]) => parentId),
      tenantId,
    );
    const fields = child.scalarColumn
      ? [[child.scalarColumn, "text"] as const]
      : (child.fields ?? []).map(([field, kind]) => [columnName(field), kind] as const);
    const columns = ["tenant_id", child.parentColumn, "position", ...fields.map(([name]) => name)];
    const rows: unknown[][] = [];
    for (const [parentId, items] of parents) {
      for (const [position, item] of items.entries()) {
        const values = child.scalarColumn ? [String(item)] : fields.map(([name, kind]) => toDb((item as Row)[(child.fields ?? []).find(([field]) => columnName(field) === name)?.[0] ?? name], kind));
        rows.push([tenantId, parentId, position, ...values]);
      }
    }
    await this.insertRows(tx, `INSERT INTO ${child.table} (${columns.join(", ")})`, "", rows);
  }

  private async flushTable(tx: Transaction, spec: TableSpec, items: Row[], tenantId: string | null, readOnly?: ReadOnlyMode) {
    // Read-only page views drop incidental changes (the next transaction reloads from the database).
    if (readOnly === "discard" && spec.table !== "audit_events") return 0;
    const tenantOwned = !isUserScoped(spec);
    const snapshot = this.snapshots.get(spec.table) ?? new Map<string, string>();
    const sequences = this.sequences.get(spec.table) ?? new Map<string, number>();
    let maxSeq = Math.max(0, ...sequences.values());
    const columns = spec.fields.map(([field]) => columnName(field));
    const updates = columns
      .filter((column) => column !== "id")
      // A user's per-tenant fields are saved on the membership; the global row keeps only account fields.
      .filter((column) => spec.table !== "users" || !(column in MEMBERSHIP_COLUMNS))
      .map((column) => `${column} = EXCLUDED.${column}`)
      .join(", ");
    const seen = new Set<string>();
    const firstWrite = sequences.size === 0;
    const upserts: unknown[][] = [];
    const written: Array<[string, Row, string]> = [];

    for (const [index, item] of items.entries()) {
      const itemId = String(item.id);
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      const serialised = JSON.stringify(item);
      if (snapshot.get(itemId) === serialised) continue;
      let seq = sequences.get(itemId);
      if (seq === undefined) {
        seq = firstWrite ? (spec.order === "desc" ? items.length - index : index + 1) : ++maxSeq;
        sequences.set(itemId, seq);
      }
      upserts.push([...spec.fields.map(([field, kind]) => toDb(item[field], kind)), seq]);
      written.push([itemId, item, serialised]);
    }

    const removed = [...snapshot.keys()].filter((existing) => !seen.has(existing));
    if (!tenantId) {
      if (upserts.length || removed.length) throw new TenantRequiredError("[db] refusing to save changes without a pharmacy account.");
      return 0;
    }
    if (readOnly === "refuse" && spec.table !== "audit_events" && (upserts.length || removed.length)) throw new ReadOnlyError();
    if (tenantOwned) {
      // tenant_id is stamped here, never taken from the record. An id that already belongs to another
      // tenant is not overwritten (the WHERE clause skips it) and the whole request is rolled back.
      const affected = await this.insertRows(
        tx,
        `INSERT INTO ${spec.table} (${[...columns, "seq", "tenant_id"].join(", ")})`,
        ` ON CONFLICT (id) DO UPDATE SET ${updates}, seq = EXCLUDED.seq WHERE ${spec.table}.tenant_id = EXCLUDED.tenant_id`,
        upserts.map((row) => [...row, tenantId]),
      );
      if (affected !== upserts.length) {
        throw new Error(`[db] ${upserts.length - affected} ${spec.table} row(s) belong to another tenant; nothing was saved.`);
      }
    } else {
      await this.insertRows(
        tx,
        `INSERT INTO ${spec.table} (${[...columns, "seq"].join(", ")})`,
        ` ON CONFLICT (id) DO UPDATE SET ${updates}, seq = EXCLUDED.seq`,
        upserts,
      );
      if (spec.table === "users") await this.syncMemberships(tx, written.map(([, item]) => item), tenantId);
    }
    for (const child of spec.children ?? []) {
      await this.writeChildren(
        tx,
        child,
        written.map(([itemId, item]) => [itemId, (item[child.property] as unknown[] | undefined) ?? []]),
        tenantId,
      );
    }
    for (const [itemId, , serialised] of written) snapshot.set(itemId, serialised);

    if (removed.length) {
      if (tenantOwned) {
        await tx.$executeRawUnsafe(`DELETE FROM ${spec.table} WHERE id = ANY($1::text[]) AND tenant_id = $2`, removed, tenantId);
      } else if (spec.table === "users") {
        await this.removeMembers(tx, removed, tenantId);
      } else {
        await tx.$executeRawUnsafe(`DELETE FROM ${spec.table} WHERE id = ANY($1::text[])`, removed);
      }
      for (const existing of removed) {
        snapshot.delete(existing);
        sequences.delete(existing);
      }
    }
    this.snapshots.set(spec.table, snapshot);
    this.sequences.set(spec.table, sequences);
    return written.length + removed.length;
  }

  /**
   * Keeps each user's membership of this tenant in step with the user record (role, status, permission
   * grants, default outlet, staff ID). Phase 2 makes the membership the source of truth.
   */
  private async syncMemberships(tx: Transaction, users: Row[], tenantId: string) {
    const rows = users.map((user) => [
      membershipId(tenantId, String(user.id)),
      tenantId,
      String(user.id),
      String(user.role),
      String(user.status ?? "ACTIVE"),
      user.grants === undefined || user.grants === null ? null : JSON.stringify(user.grants),
      typeof user.outletId === "string" && user.outletId ? user.outletId : null,
      typeof user.staffId === "string" && user.staffId ? user.staffId : null,
    ]);
    await this.insertRows(
      tx,
      `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, status, grants, default_outlet_id, staff_id)`,
      ` ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, grants = EXCLUDED.grants,` +
        ` default_outlet_id = EXCLUDED.default_outlet_id, staff_id = EXCLUDED.staff_id, updated_at = now()`,
      rows,
    );
  }

  /** A user removed from this tenant loses the membership; the global account goes only when no tenant is left. */
  private async removeMembers(tx: Transaction, userIds: string[], tenantId: string) {
    await tx.$executeRawUnsafe(`DELETE FROM user_outlets WHERE user_id = ANY($1::text[]) AND tenant_id = $2`, userIds, tenantId);
    await tx.$executeRawUnsafe(`DELETE FROM tenant_memberships WHERE user_id = ANY($1::text[]) AND tenant_id = $2`, userIds, tenantId);
    await tx.$executeRawUnsafe(
      `DELETE FROM users WHERE id = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = users.id)`,
      userIds,
    );
  }

  private async flushKv(tx: Transaction, values: Record<string, unknown>, tenantId: string) {
    let changed = 0;
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const serialized = JSON.stringify(value);
      if (this.kvSnapshot.get(key) === serialized) continue;
      await tx.$executeRawUnsafe(
        `INSERT INTO ${KV_TABLE} (tenant_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
        tenantId,
        key,
        serialized,
      );
      this.kvSnapshot.set(key, serialized);
      changed += 1;
    }
    return changed;
  }

  async flush(tx: Transaction, tenantId: string | null = txTenant.getStore()?.tenantId ?? null, readOnly: ReadOnlyMode | undefined = txTenant.getStore()?.readOnly) {
    const collections = snapshotCollections();
    if (!collections) return 0;
    const started = performance.now();
    let changed = 0;
    for (const spec of TABLES) changed += await this.flushTable(tx, spec, collections.tables[spec.table] ?? [], tenantId, readOnly);
    // Anonymous requests keep default settings in memory only; read-only sessions may only advance counters.
    if (tenantId) changed += await this.flushKv(tx, readOnly ? { counters: collections.kv.counters } : collections.kv, tenantId);
    this.lastFlush = { at: new Date().toISOString(), changed, ms: Math.round(performance.now() - started) };
    return changed;
  }

  /**
   * Formerly saved changes made outside a transaction on a timer. Every change now happens inside a request
   * or job transaction for one tenant, which saves it before committing; a timer has no tenant.
   */
  schedule() {}


  async query<T extends Row>(sql: string, params: (string | number)[]) {
    let index = 0;
    const query = sql.replace(/\?/g, () => `$${++index}`);
    const tx = transactions.getStore();
    if (tx) return tx.$queryRawUnsafe<T[]>(query, ...params);
    return this.transaction((client) => client.$queryRawUnsafe<T[]>(query, ...params));
  }

  /** Reads one app_state value directly, without the write lock or loading the working set. */
  async readKv<T>(key: string): Promise<T | undefined> {
    const explicit = txTenant.getStore()?.tenantId ?? scopedTenantId();
    const tenantId = explicit !== undefined ? explicit : await requestTenantId();
    const scope = PLATFORM_STATE_KEYS.has(key) ? PLATFORM_SCOPE : tenantId;
    if (!scope) return undefined; // anonymous: tenant values are not readable
    const read = async (client: Pick<PrismaClient, "$queryRawUnsafe">) => {
      const rows = await client.$queryRawUnsafe<{ value: string }[]>(`SELECT value FROM ${KV_TABLE} WHERE tenant_id = $1 AND key = $2`, scope, key);
      return rows[0] ? (JSON.parse(rows[0].value) as T) : undefined;
    };
    const tx = transactions.getStore();
    if (tx) return read(tx);
    // Outside a request transaction: a short read-only transaction scoped to the tenant (RLS needs it).
    return this.withClient((client) => client.$transaction(async (readTx) => {
      await setTenantScope(readTx, tenantId ?? null);
      return read(readTx);
    }));
  }

  /**
   * Short transaction without the write lock or the working set, for platform-level lookups (sign-in,
   * invitations, job scheduling). `query` runs one statement in the given tenant scope (RLS), or in no
   * tenant scope when omitted, which only sees the global tables (users, tenants, tenant_memberships).
   */
  async platform<T>(run: (query: <R = Row>(sql: string, params?: unknown[], tenantId?: string | null) => Promise<R[]>) => Promise<T>, options: { independent?: boolean } = {}): Promise<T> {
    // Inside a tenant transaction, reuse its connection (a second one could wait forever on a pool whose other
    // connections wait for this transaction's lock) and put the tenant scope back after each statement.
    // independent: commit on its own even when the surrounding request transaction later rolls back.
    const active = options.independent ? undefined : transactions.getStore();
    if (active) {
      const own = txTenant.getStore()?.tenantId ?? null;
      // Serialised with flushes on the same connection: otherwise a flush running alongside (e.g. while alert
      // emails are being logged) could write tenant rows while the scope is switched away.
      return run(<R = Row>(sql: string, params: unknown[] = [], tenantId: string | null = null) => serialised(active, async () => {
        await setTenantScope(active, tenantId, { switchRole: false });
        try {
          return await active.$queryRawUnsafe<R[]>(sql, ...params);
        } finally {
          await setTenantScope(active, own, { switchRole: false });
        }
      }));
    }
    return this.withClient((client) => client.$transaction(async (tx) => {
      let first = true;
      const query = async <R = Row>(sql: string, params: unknown[] = [], tenantId: string | null = null) => {
        await setTenantScope(tx, tenantId, { switchRole: first });
        first = false;
        return tx.$queryRawUnsafe<R[]>(sql, ...params);
      };
      return run(query);
    }));
  }

  stats() {
    const counts = Object.fromEntries([...this.snapshots].map(([table, rows]) => [table, rows.size]));
    return { database: "PostgreSQL", counts, lastFlush: this.lastFlush };
  }

  async close() {
    await this.client?.$disconnect();
  }
}


async function connectionString(override?: string) {
  if (override) return override;
  // On Workers the Hyperdrive binding is the only source of credentials; DATABASE_URL (which a build can
  // pick up from local .env files) is deliberately ignored there.
  if (isWorkersRuntime()) {
    const { env } = await getCloudflareContext({ async: true });
    const url = env.HYPERDRIVE?.connectionString;
    if (!url) throw new Error("Missing Cloudflare Hyperdrive binding `HYPERDRIVE`.");
    return url;
  }
  const localUrl = process.env.DATABASE_URL;
  if (localUrl) {
    if (!localUrl.startsWith("postgres://") && !localUrl.startsWith("postgresql://")) {
      throw new Error("DATABASE_URL must be a PostgreSQL connection string. SQLite URLs are no longer supported.");
    }
    return localUrl;
  }
  const { env } = await getCloudflareContext({ async: true });
  const url = env.HYPERDRIVE?.connectionString;
  if (!url) throw new Error("Missing Cloudflare Hyperdrive binding `HYPERDRIVE`.");
  return url;
}

async function createDatabase(connectionStringOverride?: string) {
  await import("@/lib/data");
  const { getStore } = await import("@/lib/erp/store");
  internal(() => getStore());
  const seed = snapshotCollections();
  if (!seed) throw new Error("ERP state failed to initialize.");

  const database = new PharmDb(await connectionString(connectionStringOverride));
  registry.__pharmDb = database;
  try {
    // First-run checks and demo seeding always concern the demo tenant, whoever triggered the start-up.
    await runInTenant(DEFAULT_TENANT_ID, () => database.transaction(async (tx) => {
      const { getStore: storeFactory } = await import("@/lib/erp/store");
      storeFactory();
      // Counts this tenant's rows only (users: this tenant's members).
      const counts = await tx.$queryRawUnsafe<{ table_name: string; count: bigint }[]>(
        [
          ...TABLES.map((spec) => isUserScoped(spec)
            ? `SELECT '${spec.table}' AS table_name, COUNT(*) AS count FROM ${spec.table} WHERE ${memberColumn(spec)} IN (SELECT user_id FROM tenant_memberships WHERE tenant_id = $1)`
            : `SELECT '${spec.table}' AS table_name, COUNT(*) AS count FROM ${spec.table} WHERE tenant_id = $1`),
          `SELECT '${KV_TABLE}' AS table_name, COUNT(*) AS count FROM ${KV_TABLE} WHERE tenant_id = $1`,
        ].join(" UNION ALL "),
        DEFAULT_TENANT_ID,
      );
      const existingTables = counts.filter(({ count }) => Number(count) > 0).map(({ table_name }) => table_name);
      if (existingTables.length) {
        const populated = new Set(existingTables);
        if (!populated.has("outlets") || !populated.has("users")) {
          throw new Error(`The PostgreSQL database contains incomplete ERP data (${existingTables.join(", ")}). Import or reconcile records before starting the application.`);
        }
        return;
      }
      if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO_DATA !== "1") {
        throw new Error("The PostgreSQL database has no ERP records. Import existing data or explicitly enable demo seeding.");
      }
      internal(() => restoreCollections(seed));
      await tx.$executeRawUnsafe(
        `INSERT INTO tenants (id, slug, name, is_demo) VALUES ($1, 'demo', 'Web365 Demo Pharmacy', true) ON CONFLICT (id) DO NOTHING`,
        DEFAULT_TENANT_ID,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${KV_TABLE} (tenant_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
        PLATFORM_SCOPE,
        "seededAt",
        JSON.stringify(new Date().toISOString()),
      );
      await internal(() => database.flush(tx, DEFAULT_TENANT_ID));
    }));
  } catch (error) {
    await database.close();
    delete registry.__pharmDb;
    throw error;
  }
  return database;
}

export async function initDatabase(connectionStringOverride?: string): Promise<"loaded" | "seeded" | "already"> {
  if (registry.__pharmDb) return "already";
  if (!registry.__pharmDbInit) {
    registry.__pharmDbInit = createDatabase(connectionStringOverride).then((database) => {
      registry.__pharmDb = database;
      return "loaded";
    });
  }
  return registry.__pharmDbInit;
}

/**
 * Runs SQL ($1, $2 … placeholders) on the current request's transaction, or in a new one.
 * Used for data kept outside the in-memory working set, such as stored document bytes.
 */
export async function runSql<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const active = transactions.getStore();
  if (active) return active.$queryRawUnsafe<T[]>(sql, ...params);
  return withDatabaseTransaction(() => {
    const tx = transactions.getStore();
    if (!tx) throw new Error("Database transaction unavailable.");
    return tx.$queryRawUnsafe<T[]>(sql, ...params);
  });
}

/** Lightweight read of one stored value (e.g. settings) for public pages; no request transaction needed. */
export async function readStateValue<T>(key: string): Promise<T | undefined> {
  await initDatabase();
  return getDb()?.readKv<T>(key);
}

/** True while running inside a request's database transaction, where the in-memory store is current. */
export function inDatabaseTransaction() {
  return Boolean(transactions.getStore());
}

/** Platform-level lookups outside any tenant's working set (see PharmDb.platform). */
export type PlatformQuery = <R = Row>(sql: string, params?: unknown[], tenantId?: string | null) => Promise<R[]>;

export async function platformQuery<T>(run: (query: PlatformQuery) => Promise<T>, options: { independent?: boolean } = {}): Promise<T> {
  await initDatabase();
  const database = getDb();
  if (!database) throw new Error("Database failed to initialize.");
  return database.platform(run, options);
}

/** Runs fn with no request transaction in scope (for work scheduled to run after the response, e.g. after()). */
export function outsideTransaction<T>(fn: () => T): T {
  return transactions.exit(() => txTenant.exit(fn));
}

export function getDb() {
  return registry.__pharmDb ?? null;
}

export function onDatabaseRollback(action: () => Promise<void> | void) {
  const actions = rollbackActions.getStore();
  if (!actions) throw new Error("Rollback cleanup must be registered inside a database transaction.");
  actions.push(action);
}

export async function withDatabaseTransaction<T>(callback: () => Promise<T> | T, connectionStringOverride?: string): Promise<T> {
  if (transactions.getStore()) return callback();
  await initDatabase(connectionStringOverride);
  const database = getDb();
  if (!database) throw new Error("Database failed to initialize.");
  return database.transaction(() => callback());
}

export async function flushDatabase() {
  const database = getDb();
  if (!database) return 0;
  const tx = transactions.getStore();
  if (tx) {
    // Let side effects still running (alert notifications) finish first, so their records are in this flush.
    const pending = pendingWork.getStore();
    while (pending?.length) await Promise.allSettled(pending.splice(0));
    return serialised(tx, () => database.flush(tx));
  }
  return withDatabaseTransaction(async () => 0);
}

export function scheduleFlush() {
  getDb()?.schedule();
}
