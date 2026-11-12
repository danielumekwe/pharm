// Automatic upload of offline work. Nobody presses a button: the app calls requestSync() on start, when the
// connection returns, when it comes back to the foreground, after a sale, from Background Sync where the
// browser supports it, and on a timer while work is waiting.
//
// Rules:
// - The server must answer /api/health first (Wi-Fi without internet does not count).
// - One upload run per device at a time, across tabs (Web Locks), so an operation is never sent twice at once.
// - Operations go oldest first, after the operations they depend on; one per request.
// - An operation is marked synced only after the server says "applied" (or "duplicate" of an applied one).
// - Temporary failures retry with exponential backoff and jitter; permanent refusals are not retried.

import { deviceHeaders } from "@/lib/offline/crypto";
import { offlineDatabase, type DeviceRecord, type QueueItem } from "@/lib/offline/db";
import { downloadPackage, heartbeat, removeLocalData } from "@/lib/offline/device";

export type SyncPhase = "idle" | "checking" | "uploading" | "offline" | "signin" | "error" | "revoked";
export type SyncState = { phase: SyncPhase; pending: number; attention: number; conflicts: number; done: number; total: number; lastSyncAt: string | null; message: string | null };

let state: SyncState = { phase: "idle", pending: 0, attention: 0, conflicts: 0, done: 0, total: 0, lastSyncAt: null, message: null };
const SERVER_STATE = state;
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
export const subscribeSync = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getSyncState = () => state;
export const getServerSyncState = () => SERVER_STATE;

const MAX_DELAY_MS = 15 * 60_000;
/** Exponential backoff with ±50% jitter: 5 s, 10 s, 20 s … capped at 15 minutes. */
export function backoffDelay(retries: number, random = Math.random) {
  const base = Math.min(MAX_DELAY_MS, 5000 * 2 ** Math.max(0, retries - 1));
  return Math.round(base * (0.5 + random()));
}

async function reachable() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function refreshCounts(record: DeviceRecord) {
  const db = offlineDatabase(record.tenantId, record.userId);
  const [pending, attention, conflicts, last] = await Promise.all([
    db.queue.where("status").anyOf(["pending", "uploading", "failed"]).count(),
    db.queue.where("status").equals("attention").count(),
    db.queue.where("status").equals("conflict").count(),
    db.syncHistory.orderBy("at").last(),
  ]);
  set({ pending, attention, conflicts, lastSyncAt: last?.at ?? state.lastSyncAt });
  return { pending, attention, conflicts };
}

type Outcome = { status: "applied" | "duplicate" | "conflict" | "rejected"; original?: string; message?: string; serverRef?: { saleId: string; number: string } };

async function upload(record: DeviceRecord, item: QueueItem): Promise<{ http: number; outcome?: Outcome; error?: string }> {
  const path = "/api/offline/sync";
  const headers = await deviceHeaders(record.privateKey, record.deviceId, "POST", path);
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", cache: "no-store", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ operation: { id: item.id, type: item.type, createdAt: item.createdAt, payload: item.payload } }) });
  } catch {
    return { http: 0 };
  }
  const body = (await response.json().catch(() => ({}))) as Outcome & { error?: string };
  return response.ok ? { http: response.status, outcome: body } : { http: response.status, error: body.error };
}

/** Keeps the device's own copy of a record (sale, receipt, adjustment, new product) in step with its upload. */
async function updateRecord(db: ReturnType<typeof offlineDatabase>, item: QueueItem, status: QueueItem["status"], message?: string, serverRef?: { number?: string; productId?: string }) {
  if (item.type === "sale") await db.sales.update(item.id, { syncStatus: status, serverNumber: serverRef?.number, syncMessage: message } as never);
  else if (item.type === "receiving") await db.receivings.update(item.id, { syncStatus: status, serverNumber: serverRef?.number, syncMessage: message } as never);
  else if (item.type === "adjustment") await db.adjustments.update(item.id, { syncStatus: status, serverNumber: serverRef?.number, syncMessage: message } as never);
  else if (item.type === "product" && status === "synced") await db.products.update(`local:${item.id}`, { pendingSync: false, serverId: serverRef?.productId } as never);
}

let running: Promise<void> | null = null;

/** Starts an upload run unless one is already going (in this tab or another). */
export function requestSync(record: DeviceRecord) {
  if (running) return running;
  running = (async () => {
    const run = () => syncNow(record);
    const locks = (navigator as Navigator & { locks?: { request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<void>): Promise<void> } }).locks;
    if (locks) await locks.request(`pharmaerp-sync:${record.tenantId}:${record.userId}`, { ifAvailable: true }, async (lock) => (lock ? run() : undefined));
    else await run();
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncNow(record: DeviceRecord) {
  const db = offlineDatabase(record.tenantId, record.userId);
  await refreshCounts(record);
  set({ phase: "checking", message: null });
  if (!(await reachable())) {
    set({ phase: "offline" });
    return;
  }
  // We hold the lock: anything still "uploading" was cut off (tab closed, crash). The server's idempotency
  // makes sending it again safe.
  await db.queue.where("status").equals("uploading").modify({ status: "pending" });

  let uploaded = 0;
  let stopped: SyncPhase | null = null;
  let stopMessage: string | null = null;
  const due = async () => {
    const now = new Date().toISOString();
    const candidates = await db.queue.where("status").anyOf(["pending", "failed"]).sortBy("createdAt");
    const synced = new Set((await db.queue.where("status").equals("synced").primaryKeys()) as string[]);
    // A record whose dependency could not be applied (e.g. a receipt for a product that conflicted) needs a person.
    const blocked = new Map((await db.queue.where("status").anyOf(["conflict", "attention"]).toArray()).map((item) => [item.id, item]));
    for (const item of candidates) {
      const failedDependency = item.dependsOn.find((dependency) => blocked.has(dependency));
      if (failedDependency) {
        const message = "It depends on another offline record that could not be applied; see Offline Sync & Reconciliation.";
        await db.queue.update(item.id, { status: "attention", lastError: message });
        await updateRecord(db, item, "attention", message);
      }
    }
    return candidates.filter((item) => (!item.nextAttemptAt || item.nextAttemptAt <= now) && item.dependsOn.every((dependency) => synced.has(dependency)));
  };
  let batch = await due();
  set({ phase: batch.length ? "uploading" : "idle", done: 0, total: batch.length });
  while (batch.length && !stopped) {
    for (const item of batch) {
      await db.queue.update(item.id, { status: "uploading" });
      const result = await upload(record, item);
      if (result.outcome) {
        const outcome = result.outcome;
        const effective = outcome.status === "duplicate" ? outcome.original : outcome.status;
        const status: QueueItem["status"] = effective === "applied" || effective === "resolved" ? "synced" : effective === "conflict" ? "conflict" : "attention";
        await db.queue.update(item.id, { status, lastError: outcome.message });
        await updateRecord(db, item, status, outcome.message, outcome.serverRef);
        uploaded += 1;
        set({ done: state.done + 1 });
      } else if (result.http === 401) {
        await db.queue.update(item.id, { status: "pending" });
        stopped = "signin";
        stopMessage = result.error ?? null;
        break;
      } else if (result.http === 410) {
        await removeLocalData(record.tenantId, record.userId, result.error ?? "This device was revoked.");
        stopped = "revoked";
        break;
      } else if (result.http >= 400 && result.http < 500 && result.http !== 408 && result.http !== 429) {
        // Permanent: the request itself is not acceptable; retrying the same data cannot help.
        await db.transaction("rw", [db.queue, db.failed], async () => {
          await db.queue.update(item.id, { status: "attention", lastError: result.error });
          await db.failed.put({ id: `${item.id}:${Date.now()}`, at: new Date().toISOString(), operationId: item.id, error: result.error ?? `HTTP ${result.http}` });
        });
        await updateRecord(db, item, "attention", result.error);
      } else {
        // Network drop, timeout, rate limit or server error: try again later.
        const retries = item.retries + 1;
        await db.queue.update(item.id, { status: "failed", retries, lastError: result.error ?? "Temporary connection problem", nextAttemptAt: new Date(Date.now() + backoffDelay(retries)).toISOString() });
        stopped = result.http === 0 ? "offline" : "error";
        break;
      }
    }
    if (!stopped) batch = await due();
  }
  if (stopped === "revoked") {
    set({ phase: "revoked", message: "This device was removed from offline use." });
    return;
  }
  const at = new Date().toISOString();
  if (uploaded) await db.syncHistory.add({ at, uploaded, failed: 0 });
  await refreshCounts(record);
  if (stopped) {
    set({ phase: stopped, message: stopped === "signin" ? `Sign in to upload the offline sales.${stopMessage && !/sign in/i.test(stopMessage) ? ` (${stopMessage})` : ""}` : stopped === "offline" ? null : "The server had a problem; retrying automatically." });
    return;
  }
  // Fresh stock and prices after uploading (best effort).
  if (uploaded) {
    await heartbeat(record.tenantId, record.userId).catch(() => null);
    await downloadPackage(record.tenantId, record.userId).catch(() => null);
  }
  set({ phase: "idle", lastSyncAt: uploaded ? at : state.lastSyncAt, message: null });
}

/** Earliest retry time among failed items, so the app can schedule the next attempt. */
export async function nextRetryAt(record: DeviceRecord) {
  const failed = await offlineDatabase(record.tenantId, record.userId).queue.where("status").equals("failed").toArray();
  return failed.reduce<string | null>((soonest, item) => (item.nextAttemptAt && (!soonest || item.nextAttemptAt < soonest) ? item.nextAttemptAt : soonest), null);
}
