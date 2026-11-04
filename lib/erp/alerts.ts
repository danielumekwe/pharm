// Inventory alert engine: low stock, expired and near-expiry batches.
// Every figure comes from batch-level inventory records on the server.

import { addStockMovement, batches, outlets, products, stockMovements, users, type BatchRecord, type Product } from "@/lib/data";
import { allowedOutletIds } from "@/lib/erp/access";
import {
  assertCan,
  assertOutletAccess,
  daysToExpiry,
  DomainError,
  isExpired,
  outletName,
  recordAudit,
  refreshProductStatus,
  requestPersist,
  awaitBeforeCommit,
  canPersistNow,
} from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor, AlertType, AuditSeverity, InventoryAlert, NotificationDelivery } from "@/lib/erp/types";
import { sendEmail } from "@/lib/notify/email";
import { sendPush } from "@/lib/notify/push";
import { can, effectivePermissions, isOutletScoped, type Permission } from "@/lib/rbac";

const SEVERITY_RANK: Record<AuditSeverity, number> = { info: 0, warning: 1, critical: 2 };
/** Alert types everyone with alerts.view sees; expiry handling is for inventory/compliance roles. */
export const AVAILABILITY_TYPES: AlertType[] = ["LOW_STOCK"];

// ---------------------------------------------------------------- batch-level measurements

/** Sellable units: in-date batches only (expired batches are blocked from sale and issue). */
export function availableUnits(productId: string, outletId: string, now = Date.now()) {
  return batches
    .filter((batch) => batch.productId === productId && batch.assignedOutletId === outletId && !isExpired(batch, now))
    .reduce((sum, batch) => sum + batch.availableQuantity, 0);
}

/** Units already coming: outstanding approved PO lines plus pending transfers into the outlet. */
export function onOrderUnits(product: Pick<Product, "name">, outletId: string) {
  const store = getStore();
  const fromPOs = store.purchaseOrders
    .filter((order) => order.outletId === outletId && (order.status === "Approved" || order.status === "Partially received"))
    .flatMap((order) => order.lines)
    .filter((line) => line.productName === product.name)
    .reduce((sum, line) => sum + line.quantity - line.receivedQuantity, 0);
  const transfers = stockMovements
    .filter((movement) => movement.type === "Transfer" && movement.status === "Pending" && movement.toOutletId === outletId && movement.productName === product.name)
    .reduce((sum, movement) => sum + movement.quantity, 0);
  return fromPOs + transfers;
}

export function targetLevel(product: Pick<Product, "minStock" | "maxStock">) {
  return product.maxStock && product.maxStock > product.minStock ? product.maxStock : product.minStock * 2;
}

export function stockPosition(product: Product, now = Date.now()) {
  const available = availableUnits(product.id, product.outletId, now);
  const onOrder = onOrderUnits(product, product.outletId);
  const target = targetLevel(product);
  const { criticalShortagePct } = getStore().settings;
  const low = available <= product.minStock;
  const critical = available === 0 || available <= Math.floor((product.minStock * criticalShortagePct) / 100);
  return {
    available,
    onOrder,
    target,
    suggested: Math.max(0, target - available - onOrder),
    shortage: Math.max(0, product.minStock - available),
    low,
    critical: low && critical,
  };
}

/** The tightest configured warning window the batch falls into (e.g. 45 days → 60-day window). */
export function expiryWindow(days: number) {
  const intervals = [...getStore().settings.expiryIntervals].sort((a, b) => a - b);
  return intervals.find((interval) => days <= interval) ?? null;
}

// ---------------------------------------------------------------- detection

type Condition = {
  key: string;
  type: AlertType;
  severity: AuditSeverity;
  outletId: string;
  product: Product;
  batch?: BatchRecord;
  snapshot: InventoryAlert["snapshot"];
};

function detectConditions(now = Date.now()): Condition[] {
  const conditions: Condition[] = [];
  const open = new Set(outlets.filter((outlet) => outlet.status !== "CLOSED").map((outlet) => outlet.id));

  for (const product of products) {
    if (!open.has(product.outletId) || product.status === "RESTRICTED" || product.minStock <= 0) continue;
    const position = stockPosition(product, now);
    if (!position.low) continue;
    conditions.push({
      key: `LOW_STOCK:${product.outletId}:${product.id}`,
      type: "LOW_STOCK",
      severity: position.critical ? "critical" : "warning",
      outletId: product.outletId,
      product,
      snapshot: { available: position.available, minStock: product.minStock, suggested: position.suggested, onOrder: position.onOrder, value: position.shortage * product.purchasePrice },
    });
  }

  for (const batch of batches) {
    if (batch.availableQuantity <= 0 || !open.has(batch.assignedOutletId)) continue;
    const product = products.find((row) => row.id === batch.productId);
    if (!product) continue;
    const days = daysToExpiry(batch, now);
    const value = batch.availableQuantity * batch.purchasePrice;
    if (isExpired(batch, now)) {
      conditions.push({
        key: `EXPIRED:${batch.id}`,
        type: "EXPIRED",
        severity: "critical",
        outletId: batch.assignedOutletId,
        product,
        batch,
        snapshot: { available: batch.availableQuantity, expiryDate: batch.expiryDate, daysToExpiry: days, value, disposition: batch.disposition?.status ?? "NOT_QUARANTINED" },
      });
      continue;
    }
    const window = expiryWindow(days);
    if (window === null) continue;
    const smallest = Math.min(...getStore().settings.expiryIntervals);
    conditions.push({
      key: `NEAR_EXPIRY:${batch.id}`,
      type: "NEAR_EXPIRY",
      severity: window <= smallest ? "warning" : "info",
      outletId: batch.assignedOutletId,
      product,
      batch,
      snapshot: { available: batch.availableQuantity, expiryDate: batch.expiryDate, daysToExpiry: days, window, value },
    });
  }
  return conditions;
}

const SYSTEM = { id: "system", name: "System", role: "SUPER_ADMIN" as const };

function describe(alert: Pick<InventoryAlert, "type" | "productName" | "batchNumber" | "outletId" | "snapshot" | "severity">) {
  const where = outletName(alert.outletId);
  if (alert.type === "LOW_STOCK") {
    const level = alert.snapshot.available === 0 ? "OUT OF STOCK" : alert.severity === "critical" ? "Critical shortage" : "Low stock";
    return {
      title: `${level}: ${alert.productName}`,
      body: `${where}: ${alert.snapshot.available} available (minimum ${alert.snapshot.minStock}). Suggested reorder ${alert.snapshot.suggested}${alert.snapshot.onOrder ? `, ${alert.snapshot.onOrder} already on order` : ""}.`,
    };
  }
  if (alert.type === "EXPIRED") {
    return {
      title: `Expired batch: ${alert.productName} ${alert.batchNumber}`,
      body: `${where}: ${alert.snapshot.available} unit(s) expired ${alert.snapshot.expiryDate} — ₦${(alert.snapshot.value ?? 0).toLocaleString()} at cost. Blocked from sale; quarantine and arrange return or disposal.`,
    };
  }
  return {
    title: `Expiring within ${alert.snapshot.window} days: ${alert.productName}`,
    body: `${where}: batch ${alert.batchNumber}, ${alert.snapshot.available} unit(s), expires ${alert.snapshot.expiryDate} (${alert.snapshot.daysToExpiry} days).`,
  };
}

/**
 * Reconciles alert records with current inventory. Idempotent: safe to run on every page load,
 * after stock changes and from the scheduler. Returns the newly created alerts.
 */
export function scanAlerts(now = Date.now()) {
  // Detection mutates alert records and sends notifications; only do it where the result is committed
  // (API requests and scheduled jobs). Page renders show the last committed state instead, otherwise an
  // alert created and emailed during a render would be discarded and emailed again later.
  if (!canPersistNow()) return [];
  const store = getStore();
  const stamp = new Date(now).toISOString();
  const conditions = detectConditions(now);
  const present = new Set(conditions.map((condition) => condition.key));
  const created: InventoryAlert[] = [];
  const escalated: InventoryAlert[] = [];

  for (const condition of conditions) {
    const latest = store.alerts.find((alert) => alert.key === condition.key);
    if (latest && latest.status !== "RESOLVED") {
      if (SEVERITY_RANK[condition.severity] > SEVERITY_RANK[latest.severity]) {
        latest.history.push({ at: stamp, actor: "System", action: "escalated", note: `${latest.severity} → ${condition.severity}` });
        latest.severity = condition.severity;
        escalated.push(latest);
      }
      if (condition.type === "NEAR_EXPIRY" && condition.snapshot.window !== latest.snapshot.window) {
        latest.history.push({ at: stamp, actor: "System", action: "window", note: `Now within ${condition.snapshot.window} days of expiry` });
      }
      latest.snapshot = condition.snapshot;
      latest.updatedAt = stamp;
      continue;
    }
    // A manually resolved alert stays resolved while the same condition persists, unless it gets worse.
    if (latest && latest.status === "RESOLVED" && latest.resolvedManually && !latest.clearedAt && SEVERITY_RANK[condition.severity] <= SEVERITY_RANK[latest.severity]) {
      latest.snapshot = condition.snapshot;
      continue;
    }
    const alert: InventoryAlert = {
      id: `alert-${nextNumber("alert")}`,
      key: condition.key,
      type: condition.type,
      severity: condition.severity,
      status: "OPEN",
      outletId: condition.outletId,
      productId: condition.product.id,
      productName: condition.product.name,
      batchId: condition.batch?.id,
      batchNumber: condition.batch?.batchNumber,
      snapshot: condition.snapshot,
      createdAt: stamp,
      updatedAt: stamp,
      notified: [],
      history: [{ at: stamp, actor: "System", action: "detected", note: describe({ ...condition, productName: condition.product.name, batchNumber: condition.batch?.batchNumber }).body }],
    };
    store.alerts.unshift(alert);
    created.push(alert);
  }

  // Conditions that no longer hold: auto-resolve open alerts; mark manual resolutions as cleared.
  for (const alert of store.alerts) {
    if (present.has(alert.key)) continue;
    if (alert.status !== "RESOLVED") {
      alert.status = "RESOLVED";
      alert.updatedAt = stamp;
      const reason =
        alert.type === "LOW_STOCK"
          ? "Stock back above minimum"
          : alert.type === "EXPIRED"
            ? `Batch cleared (${batches.find((batch) => batch.id === alert.batchId)?.disposition?.status ?? "no units remaining"})`
            : "Batch sold out, expired (see expired alert) or outside warning window";
      alert.history.push({ at: stamp, actor: "System", action: "auto-resolved", note: reason });
    } else if (alert.resolvedManually && !alert.clearedAt && store.alerts.find((row) => row.key === alert.key) === alert) {
      alert.clearedAt = stamp;
    }
  }
  if (store.alerts.length > 5000) store.alerts.length = 5000;
  requestPersist();

  // Immediate notifications, once per event per alert:
  //  - a new low-stock condition ("low"), or "critical" if it is already critical / escalates to critical
  //  - a newly expired batch ("expired")
  // A condition that clears auto-resolves its alert; if it recurs, a new alert (and a new notification) follows.
  for (const alert of created) {
    if (alert.type === "EXPIRED") awaitBeforeCommit(notifyAlert(alert, "expired"));
    if (alert.type === "LOW_STOCK") awaitBeforeCommit(notifyAlert(alert, alert.severity === "critical" ? "critical" : "low"));
  }
  for (const alert of escalated) {
    if (alert.type === "LOW_STOCK" && alert.severity === "critical" && !alert.notified.includes("critical")) awaitBeforeCommit(notifyAlert(alert, "critical"));
  }
  return created;
}

// ---------------------------------------------------------------- visibility

export function canSeeType(actor: Pick<Actor, "permissions">, type: AlertType) {
  if (AVAILABILITY_TYPES.includes(type)) return true;
  return actor.permissions.includes("alerts.manage") || actor.permissions.includes("reports.inventory");
}

export function visibleAlerts(actor: Actor, outletFilter?: string | null) {
  scanAlerts();
  const outletScope = outletFilter ?? actor.outletId;
  return getStore().alerts.filter(
    (alert) =>
      canSeeType(actor, alert.type) &&
      (isOutletScoped(actor.role) ? actor.outletIds.includes(alert.outletId) && (!outletScope || alert.outletId === outletScope) : !outletScope || alert.outletId === outletScope),
  );
}

export function alertSummary(actor: Actor, outletFilter?: string | null) {
  const alerts = visibleAlerts(actor, outletFilter).filter((alert) => alert.status !== "RESOLVED");
  const low = alerts.filter((alert) => alert.type === "LOW_STOCK");
  const expired = alerts.filter((alert) => alert.type === "EXPIRED");
  const near = alerts.filter((alert) => alert.type === "NEAR_EXPIRY");
  const criticalOutlets = Array.from(new Set(low.filter((alert) => alert.severity === "critical").map((alert) => alert.outletId)));
  return {
    lowStock: low.length,
    outOfStock: low.filter((alert) => alert.snapshot.available === 0).length,
    expiredBatches: expired.length,
    expiredValue: expired.reduce((sum, alert) => sum + (alert.snapshot.value ?? 0), 0),
    nearExpiry: near.length,
    nearExpiryProducts: new Set(near.map((alert) => alert.productName)).size,
    criticalOutlets: criticalOutlets.map((id) => ({ id, name: outletName(id), count: low.filter((alert) => alert.outletId === id && alert.severity === "critical").length })),
    unacknowledged: alerts.filter((alert) => alert.status === "OPEN").length,
    showExpiry: canSeeType(actor, "EXPIRED"),
    recent: [...alerts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8),
  };
}

// ---------------------------------------------------------------- actions

function findManageable(actor: Actor, alertId: string) {
  assertCan(actor, "alerts.manage");
  const alert = getStore().alerts.find((row) => row.id === alertId);
  if (!alert) throw new DomainError("Alert not found.", 404);
  if (isOutletScoped(actor.role) && !actor.outletIds.includes(alert.outletId)) throw new DomainError("This alert belongs to an outlet you are not assigned to.", 403);
  return alert;
}

export function acknowledgeAlert(actor: Actor, alertId: string, note: string) {
  const alert = findManageable(actor, alertId);
  if (alert.status !== "OPEN") throw new DomainError(`Alert is already ${alert.status.toLowerCase()}.`);
  alert.status = "ACKNOWLEDGED";
  alert.updatedAt = new Date().toISOString();
  alert.history.push({ at: alert.updatedAt, actor: actor.name, action: "acknowledged", note: note.trim() || undefined });
  recordAudit(actor, { action: "alerts.acknowledge", entity: "InventoryAlert", entityId: alert.id, summary: `Acknowledged ${describe(alert).title} @ ${outletName(alert.outletId)}${note.trim() ? ` — ${note.trim()}` : ""}`, outletId: alert.outletId });
  return alert;
}

export function resolveAlert(actor: Actor, alertId: string, note: string) {
  const alert = findManageable(actor, alertId);
  if (alert.status === "RESOLVED") throw new DomainError("Alert is already resolved.");
  if (note.trim().length < 5) throw new DomainError("Record what was done to resolve the alert (at least 5 characters).");
  if (alert.type === "EXPIRED") {
    const status = batches.find((batch) => batch.id === alert.batchId)?.disposition?.status;
    if (status !== "RETURNED" && status !== "DISPOSED") {
      throw new DomainError("Expired-stock alerts close automatically once the batch is returned to the supplier or disposed of. Record that action first.");
    }
  }
  alert.status = "RESOLVED";
  alert.resolvedManually = true;
  alert.clearedAt = undefined;
  alert.updatedAt = new Date().toISOString();
  alert.history.push({ at: alert.updatedAt, actor: actor.name, action: "resolved", note: note.trim() });
  recordAudit(actor, { action: "alerts.resolve", entity: "InventoryAlert", entityId: alert.id, summary: `Resolved ${describe(alert).title} @ ${outletName(alert.outletId)} — ${note.trim()}`, outletId: alert.outletId });
  return alert;
}

/** Per-outlet minimum (reorder point) and target level for a product. */
export function setThreshold(actor: Actor, productId: string, minStock: number, maxStock: number | null) {
  assertCan(actor, "alerts.manage");
  const product = products.find((row) => row.id === productId);
  if (!product) throw new DomainError("Item not found.", 404);
  if (isOutletScoped(actor.role) && !actor.outletIds.includes(product.outletId)) throw new DomainError("You can only set thresholds for your outlets.", 403);
  if (!Number.isInteger(minStock) || minStock < 0 || minStock > 100_000) throw new DomainError("Minimum stock must be a whole number between 0 and 100,000.");
  if (maxStock !== null && (!Number.isInteger(maxStock) || maxStock <= minStock)) throw new DomainError("Target level must be a whole number above the minimum.");
  const before = `${product.minStock}/${product.maxStock ?? "auto"}`;
  product.minStock = minStock;
  product.maxStock = maxStock ?? undefined;
  product.thresholdSource = "item";
  refreshProductStatus(product);
  recordAudit(actor, {
    action: "alerts.threshold",
    entity: "Product",
    entityId: product.id,
    summary: `${product.name} @ ${outletName(product.outletId)}: min/target ${before} → ${minStock}/${maxStock ?? "auto"}`,
    outletId: product.outletId,
  });
  scanAlerts();
  return { id: product.id, minStock: product.minStock, maxStock: product.maxStock ?? null, ...stockPosition(product) };
}

function expiredAlertFor(batchId: string) {
  return getStore().alerts.find((alert) => alert.key === `EXPIRED:${batchId}` && alert.status !== "RESOLVED");
}

/** Expired-stock handling: quarantine, return to supplier, or approved disposal. */
export function handleExpiredBatch(actor: Actor, batchId: string, action: "quarantine" | "return" | "dispose", note: string) {
  assertCan(actor, "alerts.manage");
  const batch = batches.find((row) => row.id === batchId);
  if (!batch) throw new DomainError("Batch not found.", 404);
  if (isOutletScoped(actor.role)) assertOutletAccess(actor, batch.assignedOutletId);
  if (!isExpired(batch)) throw new DomainError("Only expired batches can be quarantined, returned or disposed of here.");
  if (batch.availableQuantity <= 0) throw new DomainError("This batch has no remaining units.");
  const current = batch.disposition?.status;
  if (current === "RETURN_PENDING" || current === "DISPOSAL_PENDING") throw new DomainError("A return or disposal for this batch is already awaiting approval on the Stock page.");
  const stamp = new Date().toISOString();
  const alert = expiredAlertFor(batch.id);

  if (action === "quarantine") {
    if (current === "QUARANTINED") throw new DomainError("Batch is already quarantined.");
    batch.disposition = { status: "QUARANTINED", by: actor.name, at: stamp, note: note.trim() || undefined };
    alert?.history.push({ at: stamp, actor: actor.name, action: "quarantined", note: note.trim() || undefined });
    recordAudit(actor, { action: "compliance.quarantine", entity: "Batch", entityId: batch.id, summary: `Quarantined ${batch.availableQuantity} × ${batch.productName} batch ${batch.batchNumber} (expired ${batch.expiryDate})${note.trim() ? ` — ${note.trim()}` : ""}`, outletId: batch.assignedOutletId, severity: "warning" });
    return batch;
  }

  assertCan(actor, "stock.request");
  if (note.trim().length < 3) throw new DomainError(action === "return" ? "Record the supplier return authorisation or reference." : "Record the disposal method and witness (e.g. NAFDAC officer, certificate no.).");
  const movement = addStockMovement({
    reference: `${action === "return" ? "RTS" : "DST"}-${Date.now().toString().slice(-5)}`,
    type: "Adjustment",
    outletId: batch.assignedOutletId,
    productName: batch.productName,
    quantity: batch.availableQuantity,
    status: "Pending",
    batchId: batch.id,
    disposition: action === "return" ? "RETURN" : "DISPOSAL",
    reason: action === "return" ? `Expired — return to supplier ${batch.supplier} (batch ${batch.batchNumber}): ${note.trim()}` : `Expired — disposal of batch ${batch.batchNumber}: ${note.trim()}`,
    requestedBy: actor.name,
  });
  batch.disposition = { status: action === "return" ? "RETURN_PENDING" : "DISPOSAL_PENDING", by: actor.name, at: stamp, note: note.trim(), movementId: movement.id, supplier: batch.supplier };
  alert?.history.push({ at: stamp, actor: actor.name, action: action === "return" ? "return requested" : "disposal requested", note: `${movement.reference} awaiting approval — ${note.trim()}` });
  recordAudit(actor, {
    action: action === "return" ? "compliance.return-request" : "compliance.destruction-request",
    entity: "Batch",
    entityId: batch.id,
    summary: `${action === "return" ? `Return to ${batch.supplier}` : "Disposal"} requested: ${batch.availableQuantity} × ${batch.productName} batch ${batch.batchNumber} (${movement.reference})`,
    outletId: batch.assignedOutletId,
    severity: "warning",
  });
  return batch;
}

// ---------------------------------------------------------------- notifications

type Recipient = { id: string; name: string; email: string; permissions: Permission[] };

/** People who should hear about an alert: outlet access + permission to see that alert type. */
export function recipientsFor(alert: Pick<InventoryAlert, "type" | "outletId">): Recipient[] {
  return users
    .filter((user) => (user.status ?? "ACTIVE") === "ACTIVE")
    .map((user) => ({ user, permissions: effectivePermissions(user.role, user.grants ?? []) }))
    .filter(({ user, permissions }) => permissions.includes("alerts.view") && allowedOutletIds(user).includes(alert.outletId))
    .filter(({ permissions }) => canSeeType({ permissions }, alert.type))
    .map(({ user, permissions }) => ({ id: user.id, name: user.name, email: user.email, permissions }));
}

function logDelivery(entry: Omit<NotificationDelivery, "id" | "at">) {
  // Deliveries are retained (not truncated) while they still have retries pending.
  const store = getStore();
  store.deliveries.unshift({ id: `dlv-${nextNumber("delivery")}`, at: new Date().toISOString(), ...entry });
  if (store.deliveries.length > 20000) store.deliveries.length = 20000;
}

function inApp(userId: string, message: { title: string; body: string; severity: AuditSeverity; link: string; alertId?: string }) {
  const store = getStore();
  store.notifications.unshift({ id: `ntf-${nextNumber("notification")}`, userId, createdAt: new Date().toISOString(), ...message });
  if (store.notifications.length > 5000) store.notifications.length = 5000;
}

function appUrl() {
  return (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
}

function alertLink(alert: InventoryAlert) {
  const tab = alert.type === "LOW_STOCK" ? "low" : alert.type === "EXPIRED" ? "expired" : "near";
  return `/alerts?tab=${tab}&outlet=${alert.outletId}&q=${encodeURIComponent(alert.batchNumber ?? alert.productName)}`;
}

/** Plain-text email body with everything needed to act without opening the app. */
function alertEmail(alert: InventoryAlert, title: string, body: string) {
  const at = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const lines =
    alert.type === "LOW_STOCK"
      ? [
          `Product: ${alert.productName}`,
          `Outlet: ${outletName(alert.outletId)}`,
          `Available stock (in-date, excluding quarantined/expired batches): ${alert.snapshot.available}`,
          `Minimum stock threshold: ${alert.snapshot.minStock}`,
          `Suggested reorder quantity: ${alert.snapshot.suggested}${alert.snapshot.onOrder ? ` (${alert.snapshot.onOrder} already on order)` : ""}`,
          `Level: ${alert.snapshot.available === 0 ? "OUT OF STOCK" : alert.severity === "critical" ? "Critical shortage" : "Low stock"}`,
        ]
      : [
          `Product: ${alert.productName}`,
          `Batch: ${alert.batchNumber}`,
          `Outlet: ${outletName(alert.outletId)}`,
          `Quantity: ${alert.snapshot.available}`,
          `Expiry date: ${alert.snapshot.expiryDate}`,
          `Value at cost: ₦${(alert.snapshot.value ?? 0).toLocaleString()}`,
        ];
  return [title, "", ...lines, `Detected: ${at}`, "", body, "", `Open the inventory record: ${appUrl()}${alertLink(alert)}`, "", "— Pharmacy ERP inventory monitoring"].join("\n");
}

/** Configured extra addresses plus (optionally) the managers of the outlet, deduplicated by address. */
export function emailRecipientsFor(alert: Pick<InventoryAlert, "type" | "outletId">) {
  const config = getStore().settings.alertEmail;
  const list = new Map<string, { id: string; name: string; email: string }>();
  for (const email of config.recipients) list.set(email.toLowerCase(), { id: `email:${email.toLowerCase()}`, name: email, email });
  if (config.notifyManagers) {
    for (const recipient of recipientsFor(alert)) {
      if (!recipient.permissions.includes("alerts.manage")) continue;
      if (!list.has(recipient.email.toLowerCase())) list.set(recipient.email.toLowerCase(), { id: recipient.id, name: recipient.name, email: recipient.email });
    }
  }
  return [...list.values()];
}

function retryAt(attempts: number) {
  // Exponential backoff: 2, 4, 8 … minutes.
  return new Date(Date.now() + 2 ** attempts * 60_000).toISOString();
}

/** Sends one email and records it; failures are queued for retry up to the configured limit. */
export async function deliverEmail(
  entry: { recipientId: string; recipientName: string; event: string; alertId?: string; payload: { to: string; subject: string; text: string } },
  sender: typeof sendEmail = sendEmail,
) {
  const result = await sender(entry.payload);
  const maxRetries = getStore().settings.alertEmail.maxRetries;
  const failed = result.status === "FAILED";
  logDelivery({
    channel: "EMAIL",
    recipientId: entry.recipientId,
    recipientName: entry.recipientName,
    recipientEmail: entry.payload.to,
    subject: entry.payload.subject,
    event: entry.event,
    alertId: entry.alertId,
    status: failed && maxRetries > 0 ? "RETRYING" : result.status,
    detail: result.detail,
    attempts: 1,
    nextAttemptAt: failed && maxRetries > 0 ? retryAt(1) : undefined,
    payload: entry.payload,
  });
  return result;
}

/** Retries failed emails whose backoff has elapsed (run by the scheduler). Each delivery is retried in place, never duplicated. */
export async function processEmailRetries(sender: typeof sendEmail = sendEmail, now = Date.now()) {
  const store = getStore();
  const maxRetries = store.settings.alertEmail.maxRetries;
  const due = store.deliveries.filter((delivery) => delivery.channel === "EMAIL" && delivery.status === "RETRYING" && delivery.payload && Date.parse(delivery.nextAttemptAt ?? "") <= now);
  let sent = 0;
  for (const delivery of due) {
    delivery.status = "FAILED"; // claim it before awaiting, so overlapping ticks cannot resend
    const result = await sender(delivery.payload!);
    const attempts = (delivery.attempts ?? 1) + 1;
    delivery.attempts = attempts;
    delivery.at = new Date().toISOString();
    if (result.status === "SENT") {
      delivery.status = "SENT";
      delivery.detail = `${result.detail} (attempt ${attempts})`;
      delivery.nextAttemptAt = undefined;
      sent += 1;
    } else if (result.status === "FAILED" && attempts <= maxRetries) {
      delivery.status = "RETRYING";
      delivery.detail = `${result.detail} (attempt ${attempts} failed)`;
      delivery.nextAttemptAt = retryAt(attempts);
    } else {
      delivery.status = result.status === "SKIPPED" ? "SKIPPED" : "FAILED";
      delivery.detail = `${result.detail} (gave up after ${attempts} attempt(s))`;
      delivery.nextAttemptAt = undefined;
    }
  }
  if (due.length) requestPersist();
  return { retried: due.length, sent };
}

/** Sends one alert event to every recipient on every channel, exactly once. */
export async function notifyAlert(alert: InventoryAlert, event: string) {
  if (alert.notified.includes(event)) return;
  alert.notified.push(event); // mark first so concurrent scans cannot double-send
  const { title, body } = describe(alert);
  const link = alertLink(alert);
  const store = getStore();
  const config = store.settings.alertEmail;

  const inAppRecipients = recipientsFor(alert);
  for (const recipient of inAppRecipients) {
    inApp(recipient.id, { title, body, severity: alert.severity, link, alertId: alert.id });
    logDelivery({ channel: "IN_APP", recipientId: recipient.id, recipientName: recipient.name, subject: title, event, alertId: alert.id, status: "SENT", detail: "Shown in notification centre" });

    // Android push goes to people who act on alerts.
    if (!recipient.permissions.includes("alerts.manage")) continue;
    const devices = store.devices.filter((device) => device.userId === recipient.id);
    if (devices.length === 0) {
      logDelivery({ channel: "PUSH", recipientId: recipient.id, recipientName: recipient.name, subject: title, event, alertId: alert.id, status: "SKIPPED", detail: "No registered Android device" });
    }
    for (const device of devices) {
      const push = await sendPush(device.token, { title, body, data: { alertId: alert.id, type: alert.type, outletId: alert.outletId, link } });
      logDelivery({ channel: "PUSH", recipientId: recipient.id, recipientName: recipient.name, subject: title, event, alertId: alert.id, ...push });
    }
  }

  // Email: governed by the notification settings.
  const emailWanted = config.enabled && (event === "low" ? config.lowStockImmediate : config.criticalImmediate);
  const emailRecipients = emailWanted ? emailRecipientsFor(alert) : [];
  for (const recipient of emailRecipients) {
    await deliverEmail({ recipientId: recipient.id, recipientName: recipient.name, event, alertId: alert.id, payload: { to: recipient.email, subject: `[Pharmacy ERP] ${title}`, text: alertEmail(alert, title, body) } });
  }
  alert.history.push({
    at: new Date().toISOString(),
    actor: "System",
    action: "notified",
    note: `${event}: in-app to ${inAppRecipients.length}, email to ${emailRecipients.length}${emailWanted ? "" : " (email disabled for this event)"}`,
  });
  requestPersist();
}

export function notificationsFor(actor: Actor) {
  const list = getStore().notifications.filter((notification) => notification.userId === actor.id);
  return { unread: list.filter((notification) => !notification.readAt).length, items: list.slice(0, 30) };
}

export function markNotificationsRead(actor: Actor, ids: string[] | "all") {
  const stamp = new Date().toISOString();
  for (const notification of getStore().notifications) {
    if (notification.userId !== actor.id || notification.readAt) continue;
    if (ids === "all" || ids.includes(notification.id)) notification.readAt = stamp;
  }
  requestPersist();
  return notificationsFor(actor);
}

export function registerDevice(actor: Actor, token: string, platform: "android" | "ios" | "web", label?: string) {
  if (token.length < 20 || token.length > 4096) throw new DomainError("Invalid device token.");
  const store = getStore();
  const stamp = new Date().toISOString();
  const existing = store.devices.find((device) => device.token === token);
  if (existing) {
    existing.userId = actor.id;
    existing.lastSeenAt = stamp;
    return existing;
  }
  const device = { id: `dev-${nextNumber("device")}`, userId: actor.id, token, platform, label, registeredAt: stamp, lastSeenAt: stamp };
  store.devices.push(device);
  recordAudit(actor, { action: "devices.register", entity: "Device", entityId: device.id, summary: `${actor.name} registered a${platform === "android" ? "n Android" : ` ${platform}`} device for push notifications${label ? ` (${label})` : ""}` });
  return device;
}

export function unregisterDevice(actor: Actor, token: string) {
  const store = getStore();
  store.devices = store.devices.filter((device) => !(device.token === token && device.userId === actor.id));
  return { ok: true };
}

export { can, SYSTEM };

// ---------------------------------------------------------------- threshold rules & email settings

/** Minimum that applies to an item when it has no explicit item-level threshold: product rule → outlet rule → default. */
export function inheritedMinimum(product: Pick<Product, "name" | "outletId">) {
  const { lowStock } = getStore().settings;
  if (lowStock.productMins[product.name] !== undefined) return { minStock: lowStock.productMins[product.name], source: "product" as const };
  if (lowStock.outletMins[product.outletId] !== undefined) return { minStock: lowStock.outletMins[product.outletId], source: "outlet" as const };
  return { minStock: lowStock.defaultMin, source: "default" as const };
}

/** Re-applies rules to every item that inherits its threshold. Explicit item thresholds are left alone. */
export function applyThresholdRules() {
  let changed = 0;
  for (const product of products) {
    if ((product.thresholdSource ?? "item") === "item") continue;
    const next = inheritedMinimum(product);
    if (product.minStock !== next.minStock || product.thresholdSource !== next.source) {
      product.minStock = next.minStock;
      product.thresholdSource = next.source;
      refreshProductStatus(product);
      changed += 1;
    }
  }
  return changed;
}

export function setThresholdRule(actor: Actor, scope: "default" | "outlet" | "product", key: string, value: number | null) {
  assertCan(actor, "alerts.configure");
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 100_000)) throw new DomainError("Threshold must be a whole number between 0 and 100,000.");
  const { lowStock } = getStore().settings;
  let label: string;
  if (scope === "default") {
    if (value === null) throw new DomainError("The default threshold cannot be removed.");
    label = `default threshold ${lowStock.defaultMin} → ${value}`;
    lowStock.defaultMin = value;
  } else if (scope === "outlet") {
    if (!outlets.some((outlet) => outlet.id === key)) throw new DomainError("Unknown outlet.");
    label = `${outletName(key)} threshold ${lowStock.outletMins[key] ?? "—"} → ${value ?? "removed"}`;
    if (value === null) delete lowStock.outletMins[key];
    else lowStock.outletMins[key] = value;
  } else {
    if (!products.some((product) => product.name === key)) throw new DomainError("Unknown product.");
    label = `${key} threshold ${lowStock.productMins[key] ?? "—"} → ${value ?? "removed"}`;
    if (value === null) delete lowStock.productMins[key];
    else lowStock.productMins[key] = value;
  }
  const changed = applyThresholdRules();
  recordAudit(actor, { action: "alerts.threshold-rule", entity: "Settings", entityId: `${scope}:${key}`, summary: `${label} (${changed} inherited item(s) updated)`, severity: "warning" });
  scanAlerts();
  return { lowStock, changed };
}

/** Makes an item inherit its threshold again instead of using an explicit item value. */
export function inheritThreshold(actor: Actor, productId: string) {
  assertCan(actor, "alerts.manage");
  const product = products.find((row) => row.id === productId);
  if (!product) throw new DomainError("Item not found.", 404);
  if (isOutletScoped(actor.role) && !actor.outletIds.includes(product.outletId)) throw new DomainError("You can only change thresholds for your outlets.", 403);
  const before = product.minStock;
  const next = inheritedMinimum(product);
  product.minStock = next.minStock;
  product.thresholdSource = next.source;
  refreshProductStatus(product);
  recordAudit(actor, { action: "alerts.threshold", entity: "Product", entityId: product.id, summary: `${product.name} @ ${outletName(product.outletId)}: item threshold ${before} removed, now inherits ${next.minStock} (${next.source})`, outletId: product.outletId });
  scanAlerts();
  return { id: product.id, ...next };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function updateAlertEmailSettings(actor: Actor, input: Partial<Omit<SystemAlertEmail, "recipients">> & { recipients?: string[] }) {
  assertCan(actor, "alerts.configure");
  const config = getStore().settings.alertEmail;
  if (input.recipients) {
    const cleaned = Array.from(new Set(input.recipients.map((email) => email.trim().toLowerCase()).filter(Boolean)));
    const invalid = cleaned.filter((email) => !EMAIL_PATTERN.test(email));
    if (invalid.length) throw new DomainError(`Invalid email address: ${invalid.join(", ")}`);
    if (cleaned.length > 25) throw new DomainError("At most 25 extra recipients.");
    config.recipients = cleaned;
  }
  if (input.maxRetries !== undefined) {
    if (!Number.isInteger(input.maxRetries) || input.maxRetries < 0 || input.maxRetries > 10) throw new DomainError("Retries must be between 0 and 10.");
    config.maxRetries = input.maxRetries;
  }
  for (const key of ["enabled", "notifyManagers", "lowStockImmediate", "criticalImmediate", "dailySummary"] as const) {
    if (input[key] !== undefined) config[key] = Boolean(input[key]);
  }
  recordAudit(actor, {
    action: "alerts.email-settings",
    entity: "Settings",
    entityId: "alertEmail",
    summary: `Alert emails ${config.enabled ? "on" : "off"} · low-stock ${config.lowStockImmediate ? "on" : "off"} · critical ${config.criticalImmediate ? "on" : "off"} · daily summary ${config.dailySummary ? "on" : "off"} · managers ${config.notifyManagers ? "included" : "excluded"} · ${config.recipients.length} extra recipient(s) · ${config.maxRetries} retries`,
    severity: "warning",
  });
  return config;
}

type SystemAlertEmail = ReturnType<typeof getStore>["settings"]["alertEmail"];
