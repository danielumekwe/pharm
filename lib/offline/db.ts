// The on-device database (IndexedDB via Dexie). One database per pharmacy + user on this device, so one
// pharmacy's or person's data is never mixed with another's. Every business record also carries
// tenantId/outletId/userId/deviceId.
//
// Upgrades: add a new db.version(n) block with only the changed stores. Never drop or clear the
// queue/sales/receivings/adjustments/expenses/purchases/stockActivities/failed/conflicts stores in an
// upgrade: they hold work that has not reached the server yet.

import Dexie, { type Table } from "dexie";

import type { PinVerifier } from "@/lib/offline/crypto";

export type Scoped = { tenantId: string; outletId: string; userId: string; deviceId: string };
export type QueueStatus = "pending" | "uploading" | "synced" | "failed" | "conflict" | "attention";

export type DeviceRecord = {
  key: "device";
  deviceId: string;
  name: string;
  tenantId: string;
  tenantName: string;
  userId: string;
  userName: string;
  role: string;
  outletId: string;
  outletName: string;
  /** Non-extractable signing key (structured-cloned CryptoKey). */
  privateKey: CryptoKey;
  pin: PinVerifier;
  failedPinAttempts: number;
  registeredAt: string;
  lastPackageAt: string | null;
  validUntil: string | null;
  permissions: string[];
  cursor: string | null;
};

export type QueueItem = Scoped & {
  id: string;
  type: string;
  createdAt: string;
  payload: unknown;
  dependsOn: string[];
  retries: number;
  status: QueueStatus;
  lastError?: string;
  nextAttemptAt?: string;
};

export class OfflineDatabase extends Dexie {
  meta!: Table<DeviceRecord | { key: string; value: unknown }, string>;
  products!: Table<Record<string, unknown> & { id: string; outletId: string }, string>;
  batches!: Table<Record<string, unknown> & { id: string; productId: string }, string>;
  lists!: Table<{ key: string; value: unknown }, string>;
  suppliers!: Table<{ id: string; code: string; name: string }, string>;
  customers!: Table<{ id: string; code: string; name: string; type: string }, string>;
  drafts!: Table<Scoped & { id: string; createdAt: string; cart: unknown }, string>;
  sales!: Table<Scoped & { id: string; createdAt: string; syncStatus: QueueStatus }, string>;
  payments!: Table<Scoped & { id: string; saleId: string }, string>;
  receivings!: Table<Scoped & { id: string; createdAt: string; syncStatus: QueueStatus }, string>;
  adjustments!: Table<Scoped & { id: string; createdAt: string; syncStatus: QueueStatus }, string>;
  expenses!: Table<Scoped & { id: string; createdAt: string; syncStatus: QueueStatus }, string>;
  purchases!: Table<Scoped & { id: string; createdAt: string; syncStatus: QueueStatus }, string>;
  stockActivities!: Table<Scoped & { id: string; createdAt: string }, string>;
  queue!: Table<QueueItem, string>;
  syncHistory!: Table<{ seq?: number; at: string; uploaded: number; failed: number; note?: string }, number>;
  failed!: Table<{ id: string; at: string; operationId: string; error: string }, string>;
  conflicts!: Table<{ id: string; at: string; operationId: string; detail: string }, string>;
  reports!: Table<{ key: string; generatedAt: string; value: unknown }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: "key",
      products: "id, outletId, name, sku, *barcodes, category",
      batches: "id, productId, outletId, expiryDate",
      lists: "key",
      suppliers: "id, name, code",
      customers: "id, name, code",
      drafts: "id, createdAt",
      sales: "id, createdAt, syncStatus",
      payments: "id, saleId",
      receivings: "id, createdAt, syncStatus",
      adjustments: "id, createdAt, syncStatus",
      expenses: "id, createdAt, syncStatus",
      purchases: "id, createdAt, syncStatus",
      stockActivities: "id, createdAt",
      queue: "id, status, createdAt, type",
      syncHistory: "++seq, at",
      failed: "id, at",
      conflicts: "id, at",
      reports: "key",
    });
  }
}

/** Unsent work lives here; removing a device's data never deletes these unless they reached the server. */
export const WORK_STORES = ["queue", "sales", "payments", "receivings", "adjustments", "expenses", "purchases", "stockActivities", "failed", "conflicts", "drafts"] as const;
/** Master data downloaded from the server (safe to replace on refresh, removed on revocation). */
export const MASTER_STORES = ["products", "batches", "lists", "suppliers", "customers", "reports"] as const;

export const databaseName = (tenantId: string, userId: string) => `pharmaerp-offline:${tenantId}:${userId}`;

/** Small index of the offline profiles on this device (so the app can find them before anyone signs in). */
export type Profile = { dbName: string; tenantId: string; tenantName: string; userId: string; userName: string; outletName: string; deviceId: string; deviceName: string; validUntil: string | null };

class ProfileIndex extends Dexie {
  profiles!: Table<Profile, string>;
  constructor() {
    super("pharmaerp-offline-index");
    this.version(1).stores({ profiles: "dbName, tenantId, userId" });
  }
}

let index: ProfileIndex | null = null;
export const profileIndex = () => (index ??= new ProfileIndex());

const open = new Map<string, OfflineDatabase>();

/** Closes and forgets a database handle (before deleting the database). */
export function closeDatabase(db: OfflineDatabase) {
  db.close();
  open.delete(db.name);
}
export function offlineDatabase(tenantId: string, userId: string) {
  const name = databaseName(tenantId, userId);
  let db = open.get(name);
  if (!db) {
    db = new OfflineDatabase(name);
    open.set(name, db);
  }
  return db;
}
