import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { DATA_VERSION } from "@/lib/data-version";
import { columnName, KV_TABLE, TABLES, type ChildSpec, type FieldSpec, type TableSpec } from "@/lib/db/schema";

// PostgreSQL allows 65,535 bind parameters per statement; stay well below it.
const MAX_BIND_PARAMETERS = 30_000;

type Row = Record<string, unknown>;
type Registry = typeof globalThis & Record<string, unknown> & {
  __pharmDb?: PharmDb;
  __pharmDbInit?: Promise<"loaded" | "seeded">;
  __pharmTransactions?: AsyncLocalStorage<Transaction>;
  __pharmRollbackActions?: AsyncLocalStorage<Array<() => Promise<void> | void>>;
  __pharmPending?: AsyncLocalStorage<Promise<unknown>[]>;
};
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
  if (collections.kv.rolePermissions) registry[MATRIX_KEY] = collections.kv.rolePermissions;
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
    if (active) return callback(active);

    const actions: Array<() => Promise<void> | void> = [];
    let before: Collections | null = null;
    try {
      return await this.withClient((client) => client.$transaction(
        async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${KV_TABLE} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
          LOCK_KEY,
          "{}",
        );
        await tx.$queryRawUnsafe(`SELECT key FROM ${KV_TABLE} WHERE key = $1 FOR UPDATE`, LOCK_KEY);
        await this.load(tx);
        before = snapshotCollections();
        const pending: Promise<unknown>[] = [];
        const result = await transactions.run(tx, () => rollbackActions.run(actions, () => pendingWork.run(pending, async () => {
          const value = await callback(tx);
          // Side effects started during the request (e.g. alert notifications) finish before commit,
          // so their records are saved and Workers do not cancel them after the response.
          while (pending.length) await Promise.allSettled(pending.splice(0));
          return value;
        })));
        await this.flush(tx);
        return result;
        },
        { maxWait: 10_000, timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      ));
    } catch (error) {
      if (before) restoreCollections(before);
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

  private async loadTable(tx: Transaction, spec: TableSpec) {
    const rows = await tx.$queryRawUnsafe<Row[]>(`SELECT * FROM ${spec.table} ORDER BY seq ${spec.order === "desc" ? "DESC" : "ASC"}`);
    const sequences = new Map<string, number>();
    const snapshot = new Map<string, string>();
    const objects = rows.map((row) => {
      const object = rowToObject(row, spec.fields);
      sequences.set(String(row.id), Number(row.seq));
      return object;
    });

    for (const child of spec.children ?? []) {
      const childRows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT * FROM ${child.table} ORDER BY ${child.parentColumn}, position`,
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

  private async load(tx: Transaction) {
    const { getStore } = await import("@/lib/erp/store");
    const store = getStore() as unknown as Record<string, unknown>;
    const kvRows = await tx.$queryRawUnsafe<{ key: string; value: string }[]>(
      `SELECT key, value FROM ${KV_TABLE} WHERE key <> $1`,
      LOCK_KEY,
    );
    const kv: Record<string, unknown> = {};
    for (const row of kvRows) {
      kv[row.key] = JSON.parse(row.value);
      this.kvSnapshot.set(row.key, row.value);
    }

    for (const spec of TABLES) {
      const rows = await this.loadTable(tx, spec);
      if (spec.source.kind === "data") {
        const key = DATA_KEY(spec.source.key);
        registry[key] = replaceCollection(registry[key], rows);
      } else {
        store[spec.source.key] = replaceCollection(store[spec.source.key], rows);
      }
    }
    store.settings = kv.settings ?? store.settings;
    store.counters = kv.counters ?? {};
    store.jobRuns = kv.jobRuns ?? {};
    if (kv.rolePermissions) registry[MATRIX_KEY] = kv.rolePermissions;
    const { getStore: normalizeStore, ensureLedgerBaseline } = await import("@/lib/erp/store");
    // Databases created before the stock ledger get opening balances for existing batches (saved by this transaction).
    ensureLedgerBaseline(normalizeStore());
  }

  /** Writes many rows with as few round trips as possible: one multi-row INSERT per chunk. */
  private async insertRows(tx: Transaction, head: string, tail: string, rows: unknown[][]) {
    if (!rows.length) return;
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
      await tx.$executeRawUnsafe(`${head} VALUES ${tuples.join(", ")}${tail}`, ...parameters);
    }
  }

  private async writeChildren(tx: Transaction, child: ChildSpec, parents: Array<[string, unknown[]]>) {
    if (!parents.length) return;
    await tx.$executeRawUnsafe(
      `DELETE FROM ${child.table} WHERE ${child.parentColumn} = ANY($1::text[])`,
      parents.map(([parentId]) => parentId),
    );
    const fields = child.scalarColumn
      ? [[child.scalarColumn, "text"] as const]
      : (child.fields ?? []).map(([field, kind]) => [columnName(field), kind] as const);
    const columns = [child.parentColumn, "position", ...fields.map(([name]) => name)];
    const rows: unknown[][] = [];
    for (const [parentId, items] of parents) {
      for (const [position, item] of items.entries()) {
        const values = child.scalarColumn ? [String(item)] : fields.map(([name, kind]) => toDb((item as Row)[(child.fields ?? []).find(([field]) => columnName(field) === name)?.[0] ?? name], kind));
        rows.push([parentId, position, ...values]);
      }
    }
    await this.insertRows(tx, `INSERT INTO ${child.table} (${columns.join(", ")})`, "", rows);
  }

  private async flushTable(tx: Transaction, spec: TableSpec, items: Row[]) {
    const snapshot = this.snapshots.get(spec.table) ?? new Map<string, string>();
    const sequences = this.sequences.get(spec.table) ?? new Map<string, number>();
    let maxSeq = Math.max(0, ...sequences.values());
    const columns = spec.fields.map(([field]) => columnName(field));
    const updates = columns
      .filter((column) => column !== "id")
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

    await this.insertRows(
      tx,
      `INSERT INTO ${spec.table} (${[...columns, "seq"].join(", ")})`,
      ` ON CONFLICT (id) DO UPDATE SET ${updates}, seq = EXCLUDED.seq`,
      upserts,
    );
    for (const child of spec.children ?? []) {
      await this.writeChildren(
        tx,
        child,
        written.map(([itemId, item]) => [itemId, (item[child.property] as unknown[] | undefined) ?? []]),
      );
    }
    for (const [itemId, , serialised] of written) snapshot.set(itemId, serialised);

    const removed = [...snapshot.keys()].filter((existing) => !seen.has(existing));
    if (removed.length) {
      await tx.$executeRawUnsafe(`DELETE FROM ${spec.table} WHERE id = ANY($1::text[])`, removed);
      for (const existing of removed) {
        snapshot.delete(existing);
        sequences.delete(existing);
      }
    }
    this.snapshots.set(spec.table, snapshot);
    this.sequences.set(spec.table, sequences);
    return written.length + removed.length;
  }

  private async flushKv(tx: Transaction, values: Record<string, unknown>) {
    let changed = 0;
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const serialized = JSON.stringify(value);
      if (this.kvSnapshot.get(key) === serialized) continue;
      await tx.$executeRawUnsafe(
        `INSERT INTO ${KV_TABLE} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        key,
        serialized,
      );
      this.kvSnapshot.set(key, serialized);
      changed += 1;
    }
    return changed;
  }

  async flush(tx: Transaction) {
    const collections = snapshotCollections();
    if (!collections) return 0;
    const started = performance.now();
    let changed = 0;
    for (const spec of TABLES) changed += await this.flushTable(tx, spec, collections.tables[spec.table] ?? []);
    changed += await this.flushKv(tx, collections.kv);
    this.lastFlush = { at: new Date().toISOString(), changed, ms: Math.round(performance.now() - started) };
    return changed;
  }

  schedule() {
    // Workers do not reliably run timers after a response; every change there happens inside a request transaction.
    if (isWorkersRuntime() || transactions.getStore() || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.transaction(async () => undefined).catch((error) => console.error("[db] scheduled flush failed", error));
    }, 250);
    this.timer.unref?.();
  }

  async query<T extends Row>(sql: string, params: (string | number)[]) {
    let index = 0;
    const query = sql.replace(/\?/g, () => `$${++index}`);
    const tx = transactions.getStore();
    if (tx) return tx.$queryRawUnsafe<T[]>(query, ...params);
    return this.transaction((client) => client.$queryRawUnsafe<T[]>(query, ...params));
  }

  /** Reads one app_state value directly, without the write lock or loading the working set. */
  async readKv<T>(key: string): Promise<T | undefined> {
    const read = async (client: Pick<PrismaClient, "$queryRawUnsafe">) => {
      const rows = await client.$queryRawUnsafe<{ value: string }[]>(`SELECT value FROM ${KV_TABLE} WHERE key = $1`, key);
      return rows[0] ? (JSON.parse(rows[0].value) as T) : undefined;
    };
    const tx = transactions.getStore();
    return tx ? read(tx) : this.withClient(read);
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
  getStore();
  const seed = snapshotCollections();
  if (!seed) throw new Error("ERP state failed to initialize.");

  const database = new PharmDb(await connectionString(connectionStringOverride));
  registry.__pharmDb = database;
  try {
    await database.transaction(async (tx) => {
      const { getStore: storeFactory } = await import("@/lib/erp/store");
      storeFactory();
      const counts = await tx.$queryRawUnsafe<{ table_name: string; count: bigint }[]>(
        [
          ...TABLES.map(({ table }) => `SELECT '${table}' AS table_name, COUNT(*) AS count FROM ${table}`),
          `SELECT '${KV_TABLE}' AS table_name, COUNT(*) AS count FROM ${KV_TABLE} WHERE key <> $1`,
        ].join(" UNION ALL "),
        LOCK_KEY,
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
      restoreCollections(seed);
      await tx.$executeRawUnsafe(
        `INSERT INTO ${KV_TABLE} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        "seededAt",
        JSON.stringify(new Date().toISOString()),
      );
      await database.flush(tx);
    });
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
  if (tx) return database.flush(tx);
  return withDatabaseTransaction(async () => 0);
}

export function scheduleFlush() {
  getDb()?.schedule();
}
