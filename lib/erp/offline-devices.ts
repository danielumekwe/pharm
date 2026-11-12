// Devices registered for offline use of the installed app, and the data package each one downloads.
//
// Trust model:
// - A device is registered by a signed-in user while online. The browser creates an ECDSA P-256 key pair
//   whose private key is non-extractable (it can sign but can never be read out); the server keeps only the
//   public key.
// - Every device request needs BOTH the user's normal session and a fresh signature from the device key, so a
//   copied cookie without the device, or the device without a valid session, gets nothing.
// - Offline access expires (offline_valid_until). A disconnected device cannot learn that it was revoked
//   until it reconnects; the expiry bounds how long a lost or revoked device can keep working offline.
// - The package holds only what this user may see at this device's outlet.

import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";

import { batches, outlets, products } from "@/lib/data";
import { currentTenant, runSql } from "@/lib/db/database";
import { baseUnitName } from "@/lib/erp/ledger";
import { assertCan, assertOutletAccess, DomainError, isBatchBlocked, productPackaging, recordAudit } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { Actor, OfflinePolicy } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";
import { currentTenantId } from "@/lib/saas/tenant";

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_DEVICES_PER_USER = 10;

type DeviceRow = {
  id: string;
  user_id: string;
  user_name: string;
  outlet_id: string;
  name: string;
  platform: string | null;
  public_key: string;
  status: "ACTIVE" | "REVOKED";
  registered_at: Date;
  last_seen_at: Date | null;
  last_package_at: Date | null;
  last_sync_at: Date | null;
  offline_valid_until: Date | null;
  pending_count: number;
  failed_count: number;
  local_counts: Record<string, number>;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoke_reason: string | null;
};

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

function view(row: DeviceRow) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    userId: row.user_id,
    userName: row.user_name,
    outletId: row.outlet_id,
    outletName: outlets.find((outlet) => outlet.id === row.outlet_id)?.name ?? row.outlet_id,
    status: row.status,
    registeredAt: iso(row.registered_at),
    lastSeenAt: iso(row.last_seen_at),
    lastPackageAt: iso(row.last_package_at),
    lastSyncAt: iso(row.last_sync_at),
    offlineValidUntil: iso(row.offline_valid_until),
    pendingCount: row.pending_count,
    failedCount: row.failed_count,
    localCounts: row.local_counts ?? {},
    ready: row.status === "ACTIVE" && row.last_package_at !== null,
    revokedAt: iso(row.revoked_at),
    revokedBy: row.revoked_by,
    revokeReason: row.revoke_reason,
  };
}
export type DeviceView = ReturnType<typeof view>;

export function offlinePolicy(): OfflinePolicy {
  return getStore().settings.offline;
}

function assertNotSupport(actor: Actor) {
  if (actor.support) throw new DomainError("Support sessions cannot register or use offline devices.", 403);
}

async function deviceById(id: string) {
  const [row] = await runSql<DeviceRow>(`SELECT * FROM offline_devices WHERE id = $1 AND tenant_id = $2`, [id, currentTenantId()]);
  return row ?? null;
}

// ---------------------------------------------------------------- registration

export type RegisterInput = { name: string; platform?: string; outletId: string; publicKey: string; userAgent?: string };

/** Public key: base64 SPKI of an ECDSA P-256 key. */
function parsePublicKey(text: string) {
  try {
    const key = createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
    return key;
  } catch {
    throw new DomainError("The device key is not valid. Reload the page and try again.");
  }
}

export async function registerDevice(actor: Actor, input: RegisterInput) {
  assertNotSupport(actor);
  if (!offlinePolicy().enabled) throw new DomainError("Offline use is switched off for this pharmacy. Ask your Super Admin to enable it under Offline Mode & Devices.", 403);
  const outlet = outlets.find((entry) => entry.id === input.outletId && entry.status !== "CLOSED");
  if (!outlet) throw new DomainError("Choose one of your outlets.", 404);
  assertOutletAccess(actor, outlet.id);
  if (isOutletScoped(actor.role) && !actor.outletIds.includes(outlet.id)) throw new DomainError("You are not assigned to that outlet.", 403);
  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  if (name.length < 2) throw new DomainError("Give this device a name, e.g. “Lekki front counter”.");
  parsePublicKey(input.publicKey);
  const [{ count }] = await runSql<{ count: number }>(`SELECT count(*)::int AS count FROM offline_devices WHERE tenant_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [currentTenantId(), actor.id]);
  if (count >= MAX_DEVICES_PER_USER) throw new DomainError(`You already have ${MAX_DEVICES_PER_USER} registered devices. Remove one you no longer use first.`, 409);
  const id = `dev-${randomUUID()}`;
  await runSql(
    `INSERT INTO offline_devices (id, tenant_id, user_id, user_name, outlet_id, name, platform, user_agent, public_key, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [id, currentTenantId(), actor.id, actor.name, outlet.id, name, input.platform?.slice(0, 40) ?? null, input.userAgent?.slice(0, 300) ?? null, input.publicKey],
  );
  recordAudit(actor, { action: "devices.register", entity: "OfflineDevice", entityId: id, summary: `Registered device “${name}” for offline use at ${outlet.name}`, outletId: outlet.id });
  return view((await deviceById(id))!);
}

// ---------------------------------------------------------------- device authentication

export type DeviceProof = { deviceId: string | null; time: string | null; signature: string | null };

export function proofFromHeaders(headers: Headers): DeviceProof {
  return { deviceId: headers.get("x-device-id"), time: headers.get("x-device-time"), signature: headers.get("x-device-signature") };
}

/** The exact text a device signs for a request. */
export function signedText(deviceId: string, time: string, method: string, path: string) {
  return `${deviceId}.${time}.${method.toUpperCase()}.${path}`;
}

/**
 * Checks the device belongs to this user and pharmacy, is not revoked, and signed this request just now.
 * A revoked device gets 410, which tells the app to remove its protected local data.
 */
export async function authenticateDevice(actor: Actor, proof: DeviceProof, method: string, path: string) {
  assertNotSupport(actor);
  if (!proof.deviceId || !proof.time || !proof.signature) throw new DomainError("This device is not registered for offline use.", 401);
  const row = await deviceById(proof.deviceId);
  if (!row || row.user_id !== actor.id) throw new DomainError("This device is not registered to you in this pharmacy.", 403);
  if (row.status === "REVOKED") throw new DomainError(`This device was removed from offline use${row.revoke_reason ? `: ${row.revoke_reason}` : ""}.`, 410);
  const at = Date.parse(proof.time);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > SIGNATURE_WINDOW_MS) throw new DomainError("The device clock is too far off. Check the date and time on this device.", 401);
  const ok = verify("sha256", Buffer.from(signedText(row.id, proof.time, method, path)), { key: parsePublicKey(row.public_key), dsaEncoding: "ieee-p1363" }, Buffer.from(proof.signature, "base64"));
  if (!ok) throw new DomainError("The device signature is not valid.", 401);
  return row;
}

// ---------------------------------------------------------------- offline data package

/**
 * Everything the device needs to work offline at its outlet, for this user only.
 *
 * Incremental refresh: the device sends the fingerprint it holds for each product (`known`). Every product
 * carries a fingerprint of its details AND its batch stock, so a sale, receipt, price change or edit changes it.
 * The answer then holds only new or changed products (with their batches) and the IDs of products that are
 * gone; without `known` the full package is sent.
 */
export async function offlinePackage(actor: Actor, device: DeviceRow, known?: Record<string, string>) {
  const outlet = outlets.find((entry) => entry.id === device.outlet_id);
  if (!outlet || outlet.status === "CLOSED") throw new DomainError("This device's outlet is closed. Register the device again for another outlet.", 409);
  if (isOutletScoped(actor.role) && !actor.outletIds.includes(outlet.id)) throw new DomainError("You are no longer assigned to this device's outlet.", 403);
  const store = getStore();
  const policy = offlinePolicy();
  const issuedAt = new Date();
  const validUntil = new Date(issuedAt.getTime() + policy.sessionHours * 3_600_000);
  const today = issuedAt.toISOString().slice(0, 10);

  const items = products
    .filter((product) => product.outletId === outlet.id && (product.lifecycle ?? "ACTIVE") !== "DISCONTINUED")
    .map((product) => ({
      id: product.id,
      outletId: product.outletId,
      name: product.name,
      genericName: product.genericName,
      sku: product.sku ?? null,
      category: product.category,
      dosageForm: product.dosageForm ?? null,
      strength: product.strength,
      manufacturer: product.manufacturer,
      baseUnit: baseUnitName(product),
      barcodes: [...new Set([product.barcode, ...(product.barcodes ?? []).map((row) => row.code)].filter(Boolean))],
      barcodeLevels: (product.barcodes ?? []).map((row) => ({ code: row.code, packagingId: row.packagingId ?? null })),
      packaging: productPackaging(product).map(({ id, name, contains, unitsPerPackage, isBase, sellingPrice, minSellingPrice, sellable }) => ({ id, name, contains, unitsPerPackage, isBase, sellingPrice: sellingPrice ?? null, minSellingPrice: minSellingPrice ?? null, sellable })),
      sellingPrice: product.sellingPrice,
      minSellingPrice: product.minSellingPrice ?? null,
      // Cost prices go to staff who may see them only.
      purchasePrice: can(actor, "products.view") ? product.purchasePrice : null,
      stock: product.stock,
      minStock: product.minStock,
      status: product.status,
      lifecycle: product.lifecycle ?? "ACTIVE",
      rxOnly: Boolean(product.rxOnly),
      controlled: Boolean(product.controlled),
    }));
  const productIds = new Set(items.map((item) => item.id));
  const allBatches = batches
    .filter((batch) => batch.assignedOutletId === outlet.id && productIds.has(batch.productId) && batch.availableQuantity > 0)
    .map((batch) => ({
      id: batch.id,
      productId: batch.productId,
      outletId: batch.assignedOutletId,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      manufacturingDate: batch.manufacturingDate || null,
      availableQuantity: batch.availableQuantity,
      // Expired and quarantined stock stays restricted offline too.
      blocked: isBatchBlocked(batch) || batch.expiryDate <= today,
    }));

  const batchesOf = new Map<string, typeof allBatches>();
  for (const batch of allBatches) batchesOf.set(batch.productId, [...(batchesOf.get(batch.productId) ?? []), batch]);
  const fingerprinted = items.map((item) => ({ ...item, fp: createHash("sha1").update(JSON.stringify([item, batchesOf.get(item.id) ?? []])).digest("base64url").slice(0, 16) }));
  const delta = known !== undefined;
  const changed = delta ? fingerprinted.filter((item) => known[item.id] !== item.fp) : fingerprinted;
  const changedIds = new Set(changed.map((item) => item.id));
  const removed = delta ? Object.keys(known).filter((id) => !productIds.has(id)) : [];
  const stockBatches = allBatches.filter((batch) => changedIds.has(batch.productId));

  await runSql(`UPDATE offline_devices SET last_package_at = now(), last_seen_at = now(), offline_valid_until = $3 WHERE id = $1 AND tenant_id = $2`, [device.id, currentTenantId(), validUntil.toISOString()]);
  const tenant = currentTenant();
  return {
    format: 1,
    issuedAt: issuedAt.toISOString(),
    validUntil: validUntil.toISOString(),
    /** Where the next incremental refresh continues from. */
    cursor: issuedAt.toISOString(),
    tenant: { id: currentTenantId(), name: store.settings.businessName || tenant?.name || "Pharmacy" },
    device: { id: device.id, name: device.name },
    user: { id: actor.id, name: actor.name, role: actor.role, permissions: actor.permissions },
    outlet: { id: outlet.id, name: outlet.name, code: outlet.code, address: outlet.address, phone: outlet.phone ?? null },
    policy,
    settings: { vatRate: store.settings.vatRate, pos: store.settings.pos, nearExpiryDays: store.settings.nearExpiryDays, minShelfLifeDays: store.settings.minShelfLifeDays },
    catalog: store.settings.catalog,
    mode: delta ? ("delta" as const) : ("full" as const),
    products: changed,
    batches: stockBatches,
    removedProducts: removed,
    reports: reportSnapshot(actor, outlet.id, issuedAt),
    suppliers: can(actor, "contacts.view") || can(actor, "purchase.receive") ? store.suppliers.filter((supplier) => supplier.status === "Approved").map((supplier) => ({ id: supplier.id, code: supplier.code, name: supplier.name })) : [],
    // Names only: enough to attach a sale to a customer; no phone numbers or balances leave the server.
    customers: can(actor, "contacts.view") ? store.customers.filter((customer) => !customer.outletId || customer.outletId === outlet.id).map((customer) => ({ id: customer.id, code: customer.code, name: customer.name, type: customer.type })) : [],
  };
}

/**
 * Reports kept on the device for viewing offline (dated, never shown as live): this outlet's sales today and
 * over the last 7 days, for people allowed to see sales figures. Stock and expiry reports are built on the
 * device from the downloaded stock.
 */
function reportSnapshot(actor: Actor, outletId: string, issuedAt: Date) {
  if (!can(actor, "reports.sales") && !can(actor, "sales.supervise")) return { generatedAt: issuedAt.toISOString(), sales: null };
  const day = (offset: number) => new Date(issuedAt.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
  const sales = getStore().sales.filter((sale) => sale.outletId === outletId && sale.status !== "Voided" && sale.date.slice(0, 10) >= day(6));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = day(6 - index);
    const rows = sales.filter((sale) => sale.date.slice(0, 10) === date);
    return { date, count: rows.length, total: Math.round(rows.reduce((sum, sale) => sum + sale.total, 0) * 100) / 100 };
  });
  const today = sales.filter((sale) => sale.date.slice(0, 10) === day(0));
  const byMethod: Record<string, number> = {};
  for (const sale of today) byMethod[sale.paymentMethod] = Math.round(((byMethod[sale.paymentMethod] ?? 0) + sale.total) * 100) / 100;
  return { generatedAt: issuedAt.toISOString(), sales: { days, todayByMethod: byMethod } };
}

// ---------------------------------------------------------------- heartbeat

export async function deviceHeartbeat(device: DeviceRow, input: { pending?: number; failed?: number; counts?: Record<string, number> }) {
  const counts = Object.fromEntries(Object.entries(input.counts ?? {}).filter(([key, value]) => /^[a-zA-Z]{1,30}$/.test(key) && Number.isInteger(value) && value >= 0).slice(0, 30));
  await runSql(`UPDATE offline_devices SET last_seen_at = now(), pending_count = $3, failed_count = $4, local_counts = $5::jsonb WHERE id = $1 AND tenant_id = $2`, [
    device.id,
    currentTenantId(),
    Math.max(0, Math.floor(input.pending ?? 0)),
    Math.max(0, Math.floor(input.failed ?? 0)),
    JSON.stringify(counts),
  ]);
  return { status: "ACTIVE" as const, offlineValidUntil: iso(device.offline_valid_until), policy: offlinePolicy() };
}

// ---------------------------------------------------------------- management

/** Super Admins (settings.manage) see every device; everyone else sees their own. */
export async function listDevices(actor: Actor) {
  const all = can(actor, "settings.manage");
  const rows = await runSql<DeviceRow>(
    `SELECT * FROM offline_devices WHERE tenant_id = $1 ${all ? "" : "AND user_id = $2"} ORDER BY status, registered_at DESC LIMIT 500`,
    all ? [currentTenantId()] : [currentTenantId(), actor.id],
  );
  return rows.map(view);
}

export async function updateDevice(actor: Actor, id: string, input: { name?: string; revoke?: boolean; reason?: string }) {
  assertNotSupport(actor);
  const row = await deviceById(id);
  const admin = can(actor, "settings.manage");
  if (!row || (!admin && row.user_id !== actor.id)) throw new DomainError("Device not found.", 404);
  if (input.name !== undefined) {
    const name = input.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
    if (name.length < 2) throw new DomainError("Device names need at least 2 characters.");
    await runSql(`UPDATE offline_devices SET name = $3 WHERE id = $1 AND tenant_id = $2`, [id, currentTenantId(), name]);
    recordAudit(actor, { action: "devices.rename", entity: "OfflineDevice", entityId: id, summary: `Renamed device “${row.name}” to “${name}”`, outletId: row.outlet_id });
  }
  if (input.revoke) {
    if (row.status === "REVOKED") throw new DomainError("This device is already revoked.", 409);
    const reason = (input.reason ?? "").trim().slice(0, 300) || (row.user_id === actor.id ? "Removed by its user" : "");
    if (!reason) throw new DomainError("Give a reason for revoking this device.");
    await runSql(`UPDATE offline_devices SET status = 'REVOKED', revoked_at = now(), revoked_by = $3, revoke_reason = $4 WHERE id = $1 AND tenant_id = $2`, [id, currentTenantId(), actor.name, reason]);
    recordAudit(actor, {
      action: "devices.revoke",
      entity: "OfflineDevice",
      entityId: id,
      summary: `Revoked device “${row.name}” of ${row.user_name}: ${reason}. It loses offline access when it next connects, and at the latest when its offline access expires${row.offline_valid_until ? ` (${iso(row.offline_valid_until)})` : ""}.${row.pending_count ? ` It reported ${row.pending_count} unsent operation(s).` : ""}`,
      outletId: row.outlet_id,
      severity: "warning",
    });
  }
  return view((await deviceById(id))!);
}

export function updateOfflinePolicy(actor: Actor, input: Partial<OfflinePolicy>) {
  assertCan(actor, "settings.manage");
  const current = offlinePolicy();
  const next: OfflinePolicy = {
    enabled: input.enabled ?? current.enabled,
    sessionHours: input.sessionHours ?? current.sessionHours,
    stockPolicy: input.stockPolicy ?? current.stockPolicy,
  };
  if (!Number.isInteger(next.sessionHours) || next.sessionHours < 1 || next.sessionHours > 720) throw new DomainError("Offline access must expire after 1 to 720 hours (30 days).");
  if (!["cached-limit", "allow-negative"].includes(next.stockPolicy)) throw new DomainError("Unknown offline stock policy.");
  getStore().settings.offline = next;
  recordAudit(actor, {
    action: "devices.policy",
    entity: "Settings",
    entityId: "offline",
    summary: `Offline policy: ${next.enabled ? "enabled" : "disabled"}, access expires after ${next.sessionHours} h, offline sales ${next.stockPolicy === "cached-limit" ? "limited to downloaded stock" : "may exceed downloaded stock (reconciled later)"}`,
    severity: "warning",
  });
  return next;
}
