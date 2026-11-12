// Device provisioning and local data, on the device. Pairs with lib/erp/offline-devices.ts on the server.
//
// A device is "ready for offline use" only after its data package has been downloaded and stored.

import Dexie from "dexie";

import { checkPin, createDeviceKey, createPinVerifier, deviceHeaders } from "@/lib/offline/crypto";
import { MASTER_STORES, WORK_STORES, closeDatabase, offlineDatabase, profileIndex, type DeviceRecord, type OfflineDatabase } from "@/lib/offline/db";

export const MAX_PIN_ATTEMPTS = 5;

export class OfflineError extends Error {
  constructor(
    message: string,
    public code: "unsupported" | "revoked" | "network" | "server" | "expired" | "locked" | "wrong-pin" | "not-provisioned",
  ) {
    super(message);
  }
}

export function offlineSupported() {
  return typeof indexedDB !== "undefined" && Boolean(globalThis.crypto?.subtle);
}

async function deviceRecord(db: OfflineDatabase) {
  return (await db.meta.get("device")) as DeviceRecord | undefined;
}

async function signedFetch(record: DeviceRecord, path: string, body: unknown) {
  const headers = await deviceHeaders(record.privateKey, record.deviceId, "POST", path);
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", cache: "no-store", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  } catch {
    throw new OfflineError("PharmaERP cannot be reached.", "network");
  }
  if (response.status === 410) {
    const reason = ((await response.json().catch(() => ({}))) as { error?: string }).error ?? "This device was revoked.";
    await removeLocalData(record.tenantId, record.userId, reason);
    throw new OfflineError(reason, "revoked");
  }
  if (!response.ok) throw new OfflineError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${response.status}).`, "server");
  return response.json();
}

// ---------------------------------------------------------------- provisioning

export type ProvisionInput = {
  tenantId: string;
  tenantName: string;
  userId: string;
  userName: string;
  role: string;
  outletId: string;
  outletName: string;
  deviceName: string;
  pin: string;
  platform?: string;
};

/** Registers this device with the server, stores its key and PIN verifier, then downloads its data. */
export async function provisionDevice(input: ProvisionInput) {
  if (!offlineSupported()) throw new OfflineError("This browser cannot store data for offline use.", "unsupported");
  const pin = await createPinVerifier(input.pin);
  const key = await createDeviceKey();
  const response = await fetch("/api/offline/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.deviceName, platform: input.platform, outletId: input.outletId, publicKey: key.publicKey }),
  }).catch(() => {
    throw new OfflineError("PharmaERP cannot be reached. Registering a device needs an internet connection.", "network");
  });
  const device = (await response.json().catch(() => ({}))) as { id?: string; name?: string; error?: string };
  if (!response.ok || !device.id) throw new OfflineError(device.error ?? "The device could not be registered.", "server");

  const db = offlineDatabase(input.tenantId, input.userId);
  const record: DeviceRecord = {
    key: "device",
    deviceId: device.id,
    name: device.name ?? input.deviceName,
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    userId: input.userId,
    userName: input.userName,
    role: input.role,
    outletId: input.outletId,
    outletName: input.outletName,
    privateKey: key.privateKey,
    pin,
    failedPinAttempts: 0,
    registeredAt: new Date().toISOString(),
    lastPackageAt: null,
    validUntil: null,
    permissions: [],
    cursor: null,
  };
  await db.meta.put(record);
  await requestPersistentStorage();
  await profileIndex().profiles.put({ dbName: db.name, tenantId: input.tenantId, tenantName: input.tenantName, userId: input.userId, userName: input.userName, outletName: input.outletName, deviceId: device.id, deviceName: record.name, validUntil: null });
  await downloadPackage(input.tenantId, input.userId);
  return localStatus(input.tenantId, input.userId);
}

type Package = {
  issuedAt: string;
  validUntil: string;
  cursor: string;
  tenant: { id: string; name: string };
  user: { id: string; name: string; role: string; permissions: string[] };
  outlet: { id: string; name: string };
  products: Array<Record<string, unknown> & { id: string; outletId: string }>;
  batches: Array<Record<string, unknown> & { id: string; productId: string }>;
  suppliers: { id: string; code: string; name: string }[];
  customers: { id: string; code: string; name: string; type: string }[];
  [key: string]: unknown;
};

/**
 * Downloads the device's data and stores it. After the first download only changes are fetched: the device
 * sends the fingerprint of every product it holds and receives new/changed products (with their batches)
 * and the IDs of removed ones. `full` forces a complete download. Unsent work is never touched.
 */
export async function downloadPackage(tenantId: string, userId: string, options: { full?: boolean } = {}) {
  const db = offlineDatabase(tenantId, userId);
  const record = await deviceRecord(db);
  if (!record) throw new OfflineError("This device is not set up for offline use.", "not-provisioned");
  const incremental = !options.full && Boolean(record.lastPackageAt);
  const known: Record<string, string> = {};
  if (incremental) {
    await db.products.each((product) => {
      if (!String(product.id).startsWith("local:") && typeof product.fp === "string") known[product.id] = product.fp;
    });
  }
  const data = (await signedFetch(record, "/api/offline/package", incremental ? { known } : {})) as Package & { mode?: "full" | "delta"; removedProducts?: string[]; reports?: unknown };
  if (data.tenant.id !== tenantId || data.user.id !== userId) throw new OfflineError("The downloaded data belongs to another account.", "server");
  const scope = { tenantId, userId, deviceId: record.deviceId };
  await db.transaction("rw", [db.meta, db.products, db.batches, db.lists, db.suppliers, db.customers, db.reports], async () => {
    if (data.mode === "delta") {
      // Only what changed: replace those products and their batches, drop removed products.
      const touched = [...data.products.map((product) => product.id), ...(data.removedProducts ?? [])];
      await db.batches.where("productId").anyOf(touched).delete();
      await db.products.bulkDelete(data.removedProducts ?? []);
      await db.products.bulkPut(data.products.map((product) => ({ ...product, ...scope })));
      await db.batches.bulkPut(data.batches.map((batch) => ({ ...batch, ...scope })));
    } else {
      // Products created on this device and not yet created on the server are kept.
      const local = await db.products.filter((product) => String(product.id).startsWith("local:") && product.pendingSync === true).toArray();
      await Promise.all([db.products.clear(), db.batches.clear()]);
      await db.products.bulkPut([...data.products.map((product) => ({ ...product, ...scope })), ...local]);
      await db.batches.bulkPut(data.batches.map((batch) => ({ ...batch, ...scope })));
    }
    await Promise.all([db.lists.clear(), db.suppliers.clear(), db.customers.clear()]);
    await db.suppliers.bulkPut(data.suppliers);
    await db.customers.bulkPut(data.customers);
    await db.lists.bulkPut(["policy", "settings", "catalog", "outlet", "tenant", "user"].map((key) => ({ key, value: data[key] })));
    if (data.reports) await db.reports.put({ key: "server", generatedAt: data.issuedAt, value: data.reports });
    await db.meta.put({ ...record, lastPackageAt: data.issuedAt, validUntil: data.validUntil, permissions: data.user.permissions, cursor: data.cursor, outletName: data.outlet.name, tenantName: data.tenant.name });
    await db.meta.put({ key: "lastDownload", value: { at: data.issuedAt, mode: data.mode ?? "full", products: data.products.length, removed: data.removedProducts?.length ?? 0 } });
  });
  await profileIndex().profiles.update(db.name, { validUntil: data.validUntil, outletName: data.outlet.name, tenantName: data.tenant.name });
  return localStatus(tenantId, userId);
}

/**
 * Asks the browser to keep offline data even when the device is short of space (and, on iPhone/iPad, beyond
 * Safari's 7-day clean-up of unused sites). Returns whether storage is persistent.
 */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

/** Check-in: reports unsent work to the server; learns about revocation (410 removes protected data). */
export async function heartbeat(tenantId: string, userId: string) {
  const db = offlineDatabase(tenantId, userId);
  const record = await deviceRecord(db);
  if (!record) return null;
  const status = await localStatus(tenantId, userId);
  const answer = (await signedFetch(record, "/api/offline/heartbeat", { pending: status.pending, failed: status.failed, counts: status.counts })) as { status: string; offlineValidUntil: string | null; resolved?: string[] };
  // Records settled in the reconciliation centre stop being flagged on the device.
  for (const id of answer.resolved ?? []) {
    const item = await db.queue.get(id);
    if (!item || item.status === "synced") continue;
    await db.queue.update(id, { status: "synced", lastError: "Resolved in the reconciliation centre" });
    const table = ({ sale: "sales", receiving: "receivings", adjustment: "adjustments", product: "products" } as Record<string, string>)[item.type];
    if (table && table !== "products") await db.table(table).update(id, { syncStatus: "synced", syncMessage: "Resolved in the reconciliation centre" });
  }
  return answer;
}

// ---------------------------------------------------------------- status

export async function localStatus(tenantId: string, userId: string) {
  const db = offlineDatabase(tenantId, userId);
  const record = await deviceRecord(db);
  const [products, batches, suppliers, customers, pending, failed, barcodes] = await Promise.all([
    db.products.count(),
    db.batches.count(),
    db.suppliers.count(),
    db.customers.count(),
    db.queue.where("status").noneOf(["synced"]).count(),
    db.queue.where("status").anyOf(["failed", "conflict", "attention"]).count(),
    db.products.orderBy("barcodes").keys().then((keys) => keys.length),
  ]);
  const device = record ? (({ privateKey, pin, ...rest }) => (void privateKey, void pin, rest))(record) : null;
  const lastDownload = ((await db.meta.get("lastDownload")) as { value: { at: string; mode: string; products: number; removed: number } } | undefined)?.value ?? null;
  const persisted = typeof navigator !== "undefined" && navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const expired = Boolean(record?.validUntil && Date.parse(record.validUntil) <= Date.now());
  return {
    provisioned: Boolean(record),
    ready: Boolean(record?.lastPackageAt) && !expired,
    expired,
    device,
    counts: { products, batches, barcodes, suppliers, customers },
    pending,
    failed,
    lastDownload,
    persisted,
  };
}
export type LocalStatus = Awaited<ReturnType<typeof localStatus>>;

// ---------------------------------------------------------------- offline unlock

/**
 * Offline sign-in with the device PIN. Works only for a provisioned device whose offline access has not
 * expired; after MAX_PIN_ATTEMPTS wrong PINs the device needs an online sign-in again.
 */
export async function unlockOffline(tenantId: string, userId: string, pin: string) {
  const db = offlineDatabase(tenantId, userId);
  const record = await deviceRecord(db);
  if (!record?.lastPackageAt) throw new OfflineError("This device has not been set up for offline use. Sign in online first.", "not-provisioned");
  if (!record.validUntil || Date.parse(record.validUntil) <= Date.now()) throw new OfflineError("Offline access has expired. Connect to the internet and sign in again.", "expired");
  if (record.failedPinAttempts >= MAX_PIN_ATTEMPTS) throw new OfflineError("Too many wrong PINs. Connect to the internet and sign in again.", "locked");
  if (!(await checkPin(pin, record.pin))) {
    const attempts = record.failedPinAttempts + 1;
    await db.meta.put({ ...record, failedPinAttempts: attempts });
    throw new OfflineError(attempts >= MAX_PIN_ATTEMPTS ? "Too many wrong PINs. Connect to the internet and sign in again." : `Wrong PIN. ${MAX_PIN_ATTEMPTS - attempts} attempt(s) left.`, attempts >= MAX_PIN_ATTEMPTS ? "locked" : "wrong-pin");
  }
  if (record.failedPinAttempts) await db.meta.put({ ...record, failedPinAttempts: 0 });
  return { userId, userName: record.userName, role: record.role, permissions: record.permissions, outletId: record.outletId, outletName: record.outletName, tenantName: record.tenantName, validUntil: record.validUntil, permissionsRefreshedAt: record.lastPackageAt };
}

/** A successful online sign-in clears PIN lockouts. */
export async function resetPinAttempts(tenantId: string, userId: string) {
  const db = offlineDatabase(tenantId, userId);
  const record = await deviceRecord(db);
  if (record?.failedPinAttempts) await db.meta.put({ ...record, failedPinAttempts: 0 });
}

// ---------------------------------------------------------------- removal

/**
 * Removes the protected local data: downloaded products, stock, customers, the device key and PIN. Work that
 * has not reached the server is kept (it is evidence of real sales and stock movements) and reported; once
 * nothing unsent remains, the whole database is deleted.
 */
export async function removeLocalData(tenantId: string, userId: string, reason: string) {
  const db = offlineDatabase(tenantId, userId);
  const unsent = await db.queue.where("status").noneOf(["synced"]).count();
  if (unsent === 0) {
    closeDatabase(db);
    await Dexie.delete(db.name);
  } else {
    await db.transaction("rw", [db.meta, ...MASTER_STORES.map((store) => db.table(store))], async () => {
      await Promise.all(MASTER_STORES.map((store) => db.table(store).clear()));
      await db.meta.delete("device");
      await db.meta.put({ key: "removed", value: { at: new Date().toISOString(), reason, unsent } });
    });
  }
  await profileIndex().profiles.delete(db.name);
  return { unsentKept: unsent, workStores: WORK_STORES.length };
}

/** "Remove this device": revokes it on the server (when reachable), then removes the local data. */
export async function forgetDevice(tenantId: string, userId: string) {
  const db = offlineDatabase(tenantId, userId);
  const record = await deviceRecord(db);
  if (record) {
    await fetch(`/api/offline/devices/${encodeURIComponent(record.deviceId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revoke: true, reason: "Removed on the device by its user" }) }).catch(() => null);
  }
  return removeLocalData(tenantId, userId, "Removed by its user");
}

/** The device record (with its signing key) for this pharmacy + user, if this device is set up. */
export async function deviceFor(tenantId: string, userId: string) {
  return deviceRecord(offlineDatabase(tenantId, userId));
}
