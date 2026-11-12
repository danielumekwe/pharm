// Uploads from offline devices. Each operation carries a UUID made on the device; it is applied at most once
// (offline_operations, keyed by pharmacy + UUID) and always gets an explicit outcome:
//   applied   - posted through the normal business rules (sales via createSale, products via registerProduct,
//               receipts via receiveDirect → stock ledger, adjustments via the normal approval request)
//   duplicate - this UUID was already received; the stored outcome is returned, nothing is applied again
//   conflict  - kept in full for the reconciliation centre (stock, prices or data changed meanwhile)
//   rejected  - can never be applied as sent (e.g. discount above the cashier's limit); kept for review
// One operation per request: the request is one database transaction, so an operation lands completely or
// not at all. evaluate() is shared with the reconciliation centre's "retry".

import { z } from "zod";

import { products, users } from "@/lib/data";
import { runSql } from "@/lib/db/database";
import { receiveDirect } from "@/lib/erp/inventory";
import { baseUnitName } from "@/lib/erp/ledger";
import { newId } from "@/lib/erp/ids";
import { offlinePolicy } from "@/lib/erp/offline-devices";
import { packagePrice } from "@/lib/erp/packaging";
import { registerProduct } from "@/lib/erp/products";
import { priceBasket, PricingError } from "@/lib/erp/sale-pricing";
import { createSale, DomainError, productPackaging, recordAudit, requestStockMovement, sellableQuantity } from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { effectivePermissions, isOutletScoped } from "@/lib/rbac";
import { currentTenantId } from "@/lib/saas/tenant";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = z.number().finite().min(0).max(1e10);
const discount = z.object({ type: z.enum(["percent", "amount"]), value: z.number().finite().min(0) });
const text = (max: number) => z.string().max(max).optional();
/** A product: its server ID, or the offline operation that created it on the device. */
const productReference = { productId: z.string().max(120).optional(), productRef: z.string().regex(UUID).optional(), productName: z.string().max(160) };

const saleSchema = z.object({
  localNumber: z.string().min(3).max(40),
  outletId: z.string().min(1).max(80),
  customerId: z.string().max(80).nullable().optional(),
  walkIn: z.object({ name: text(80), phone: text(30) }).optional(),
  prescriptionRef: text(80),
  lines: z
    .array(z.object({ productId: z.string().max(120), productName: z.string().max(160), packagingId: z.string().max(120), quantity: z.number().int().positive().max(100_000), packPrice: money, discount: discount.optional() }))
    .min(1)
    .max(200),
  globalDiscount: discount.optional(),
  payments: z.array(z.object({ method: z.enum(["Cash", "Card", "Transfer"]), amount: money, reference: text(80) })).min(1).max(10),
  totals: z.object({ subtotal: money, discount: money, vat: money, total: money }),
});

const productSchema = z.object({
  localNumber: z.string().min(3).max(40),
  name: z.string().min(2).max(120),
  genericName: text(120),
  sku: text(32),
  category: z.string().max(60),
  dosageForm: text(60),
  strength: text(40),
  manufacturer: text(120),
  packaging: z.array(z.object({ name: z.string().min(1).max(40), contains: z.number().int().min(1).max(10_000) })).min(1).max(6),
  purchasePrice: money,
  sellingPrice: money,
  barcode: text(48),
  minStock: z.number().int().min(0).max(10_000_000).optional(),
});

const receivingSchema = z.object({
  localNumber: z.string().min(3).max(40),
  ...productReference,
  supplierId: z.string().max(80),
  quantity: z.number().int().positive().max(10_000_000),
  /** Packaging level by name (IDs of a product created offline are only known on the server). */
  packagingName: z.string().max(40),
  unitCost: money,
  batchNumber: z.string().min(1).max(40),
  manufacturingDate: z.string().max(10),
  expiryDate: z.string().max(10),
  invoiceNumber: text(60),
  purchaseReference: text(60),
  note: text(300),
});

const adjustmentSchema = z.object({
  localNumber: z.string().min(3).max(40),
  ...productReference,
  batchId: text(120),
  direction: z.enum(["IN", "OUT"]),
  quantity: z.number().int().positive().max(10_000_000),
  reason: z.string().min(3).max(200),
});

export const OPERATION_TYPES = ["sale", "product", "receiving", "adjustment"] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const operationSchema = z.object({
  id: z.string().regex(UUID, "Operation IDs are UUIDs."),
  type: z.enum(OPERATION_TYPES),
  createdAt: z.string().max(40),
  payload: z.unknown(),
});
export type OfflineOperation = z.infer<typeof operationSchema>;

export type ServerRef = { saleId?: string; number?: string; productId?: string; batchId?: string; movementId?: string };
export type OperationOutcome = {
  id: string;
  status: "applied" | "duplicate" | "conflict" | "rejected";
  /** Original outcome when status is "duplicate". */
  original?: "applied" | "conflict" | "rejected" | "resolved";
  message?: string;
  serverRef?: ServerRef;
};

export type DeviceInfo = { id: string; name: string; outlet_id: string; user_id: string; registered_at: Date };
type Evaluated = { status: "APPLIED" | "CONFLICT" | "REJECTED"; message?: string; serverRef?: ServerRef; localReference: string | null };

const STORED: Record<string, "applied" | "conflict" | "rejected" | "resolved"> = { APPLIED: "applied", CONFLICT: "conflict", REJECTED: "rejected", RESOLVED: "resolved" };
const TYPE_LABEL: Record<OperationType, string> = { sale: "sale", product: "new product", receiving: "stock receipt", adjustment: "stock adjustment" };

/** Tells the people who approve stock at this outlet (in the app's notification bell). */
export function notifyStockApprovers(outletId: string, title: string, body: string) {
  const store = getStore();
  for (const user of users) {
    if ((user.status ?? "ACTIVE") !== "ACTIVE" || !effectivePermissions(user.role, user.grants ?? []).includes("stock.approve")) continue;
    if (isOutletScoped(user.role) && !(user.outletIds ?? []).includes(outletId)) continue;
    store.notifications.unshift({ id: newId("ntf", `${Date.now()}-${nextNumber("notification")}`), userId: user.id, title, body, severity: "warning", link: "/inventory/offline", createdAt: new Date().toISOString() });
  }
}

const conflict = (message: string, localReference: string | null): Evaluated => ({ status: "CONFLICT", message, localReference });
const rejected = (message: string, localReference: string | null): Evaluated => ({ status: "REJECTED", message, localReference });
const isDomain = (error: unknown) => error instanceof DomainError || (error as Error)?.name === "DomainError";

/** The server product a payload refers to: a server ID, or the product created by an earlier offline operation. */
async function resolveProduct(payload: { productId?: string; productRef?: string; productName: string }, outletId: string, localReference: string) {
  let productId = payload.productId;
  if (!productId && payload.productRef) {
    const [row] = await runSql<{ status: string; result: OperationOutcome }>(`SELECT status, result FROM offline_operations WHERE tenant_id = $1 AND id = $2`, [currentTenantId(), payload.productRef]);
    if (!row || !["APPLIED", "RESOLVED"].includes(row.status) || !row.result?.serverRef?.productId) {
      return { error: conflict(`${payload.productName} was created offline but has not been created in PharmaERP${row ? ` (${STORED[row.status]})` : ""}.`, localReference) };
    }
    productId = row.result.serverRef.productId;
  }
  const product = products.find((entry) => entry.id === productId && entry.outletId === outletId);
  if (!product) return { error: conflict(`${payload.productName} is not stocked at this outlet any more.`, localReference) };
  return { product };
}

/**
 * Selling prices this item really had during the device's offline window: the current price and every
 * selling price recorded in the price history since then. An offline sale must have charged one of them.
 */
function priceCandidates(productId: string, packagingId: string, soldAt: string) {
  const product = products.find((row) => row.id === productId)!;
  const level = productPackaging(product).find((row) => row.id === packagingId)!;
  const current = packagePrice(level, product, "sellingPrice") ?? product.sellingPrice * level.unitsPerPackage;
  const windowStart = new Date(Date.parse(soldAt) - offlinePolicy().sessionHours * 3_600_000).toISOString();
  const label = level.isBase ? `per ${baseUnitName(product)}` : level.name;
  const prices = new Set([current]);
  for (const change of getStore().priceHistory) {
    if (change.productId !== productId || change.kind !== "selling" || change.at < windowStart) continue;
    for (const value of [change.oldValue, change.newValue]) {
      if (value === null || value === undefined) continue;
      if (change.level === label) prices.add(value);
      // A base-unit price change also changed packages priced from the base price.
      else if (change.level === `per ${baseUnitName(product)}` && !(level.sellingPrice && level.sellingPrice > 0)) prices.add(Math.round(value * level.unitsPerPackage * 100) / 100);
    }
  }
  return [...prices];
}

async function evaluateSale(actor: Actor, device: DeviceInfo, operation: OfflineOperation, at: string): Promise<Evaluated> {
  const parsed = saleSchema.safeParse(operation.payload);
  if (!parsed.success) return rejected("The sale data is incomplete or damaged.", null);
  const sale = parsed.data;
  const ref = sale.localNumber;
  if (sale.outletId !== device.outlet_id) return rejected("The sale was made for a different outlet than this device's.", ref);

  // Products and packaging still exist, and each line charged a price the item really had.
  const chargedPrices: number[] = [];
  const units = new Map<string, number>();
  for (const line of sale.lines) {
    const product = products.find((row) => row.id === line.productId && row.outletId === sale.outletId);
    if (!product) return conflict(`${line.productName} is no longer stocked at this outlet.`, ref);
    const level = productPackaging(product).find((row) => row.id === line.packagingId);
    if (!level) return conflict(`The ${line.productName} package sold offline no longer exists.`, ref);
    const candidates = priceCandidates(product.id, level.id, at);
    if (!candidates.some((price) => Math.abs(price - line.packPrice) < 0.005)) {
      return conflict(`${product.name} was sold at ₦${line.packPrice.toLocaleString()} per ${level.name.toLowerCase()}, which is not a price it had (now ₦${candidates[0].toLocaleString()}).`, ref);
    }
    chargedPrices.push(line.packPrice);
    units.set(product.id, (units.get(product.id) ?? 0) + line.quantity * level.unitsPerPackage);
  }

  // The totals the customer paid must follow from those prices with today's rules (same arithmetic as the till).
  let server;
  try {
    server = priceBasket({ lines: sale.lines.map((line) => ({ packPrice: line.packPrice, quantity: line.quantity, discount: line.discount })), globalDiscount: sale.globalDiscount, vatRate: getStore().settings.vatRate });
  } catch (error) {
    if (error instanceof PricingError) return rejected(error.message, ref);
    throw error;
  }
  if (Math.abs(server.total - sale.totals.total) > 0.01) {
    return conflict(`Totals differ: the device charged ₦${sale.totals.total.toLocaleString()}, the server calculates ₦${server.total.toLocaleString()} (was the VAT rate changed?).`, ref);
  }

  // Stock: offline snapshots never overwrite balances. If the stock is gone (sold by another till), the sale
  // is kept as a conflict for an Inventory Manager rather than pushing balances negative.
  for (const [productId, needed] of units) {
    const available = sellableQuantity(productId, sale.outletId);
    if (needed > available) {
      const product = products.find((row) => row.id === productId)!;
      return conflict(`Not enough usable stock of ${product.name}: the sale needs ${needed} ${baseUnitName(product).toLowerCase()}(s), ${available} are available now.`, ref);
    }
  }

  const unverified = sale.payments.filter((tender) => tender.method !== "Cash" && tender.amount > 0);
  try {
    const posted = createSale(
      actor,
      {
        outletId: sale.outletId,
        customerId: sale.customerId ?? null,
        lines: sale.lines.map((line) => ({ productId: line.productId, packagingId: line.packagingId, quantity: line.quantity, discount: line.discount })),
        globalDiscount: sale.globalDiscount,
        payments: sale.payments,
        prescriptionRef: sale.prescriptionRef,
        walkIn: sale.walkIn,
      },
      {
        chargedPrices,
        at,
        offline: { operationId: operation.id, deviceId: device.id, deviceName: device.name, localNumber: sale.localNumber, soldAt: at, syncedAt: new Date().toISOString(), unverifiedTenders: unverified.length ? unverified : undefined },
      },
    );
    if (unverified.length) {
      notifyStockApprovers(device.outlet_id, "Offline card/transfer payment to verify", `${posted.number} (offline ${sale.localNumber}): ${unverified.map((tender) => `${tender.method} ₦${tender.amount.toLocaleString()}`).join(", ")} recorded without a connection.`);
    }
    return { status: "APPLIED", serverRef: { saleId: posted.id, number: posted.number }, localReference: ref };
  } catch (error) {
    // Business-rule refusals (discount limit, prescription reference, credit limit...) can never succeed as sent.
    if (isDomain(error)) return rejected((error as Error).message, ref);
    throw error;
  }
}

async function evaluateProduct(actor: Actor, device: DeviceInfo, operation: OfflineOperation): Promise<Evaluated> {
  const parsed = productSchema.safeParse(operation.payload);
  if (!parsed.success) return rejected("The product data is incomplete or damaged.", null);
  const input = parsed.data;
  const ref = input.localNumber;
  // Registered online meanwhile (e.g. by a colleague): kept as a conflict so nobody gets a duplicate item.
  const existing = products.find((product) => product.outletId === device.outlet_id && product.name.toLowerCase() === input.name.trim().toLowerCase());
  if (existing) return conflict(`${existing.name} already exists at this outlet (registered while this device was offline).`, ref);
  try {
    const product = registerProduct(actor, {
      name: input.name,
      sku: input.sku || undefined,
      genericName: input.genericName,
      category: input.category,
      dosageForm: input.dosageForm || undefined,
      strength: input.strength,
      manufacturer: input.manufacturer,
      outletId: device.outlet_id,
      minStock: input.minStock,
      packaging: input.packaging,
      pricing: { purchasePrice: input.purchasePrice, sellingPrice: input.sellingPrice },
      barcodeMode: input.barcode ? "manufacturer" : "none",
      barcodes: input.barcode ? [{ code: input.barcode, packagingIndex: input.packaging.length - 1 }] : undefined,
    });
    return { status: "APPLIED", serverRef: { productId: product.id }, localReference: ref };
  } catch (error) {
    if (isDomain(error)) return /already (used|registered)/i.test((error as Error).message) ? conflict((error as Error).message, ref) : rejected((error as Error).message, ref);
    throw error;
  }
}

async function evaluateReceiving(actor: Actor, device: DeviceInfo, operation: OfflineOperation, at: string): Promise<Evaluated> {
  const parsed = receivingSchema.safeParse(operation.payload);
  if (!parsed.success) return rejected("The receipt data is incomplete or damaged.", null);
  const input = parsed.data;
  const ref = input.localNumber;
  const resolved = await resolveProduct(input, device.outlet_id, ref);
  if (resolved.error) return resolved.error;
  const level = productPackaging(resolved.product).find((row) => row.name.toLowerCase() === input.packagingName.toLowerCase());
  if (!level) return conflict(`${resolved.product.name} has no “${input.packagingName}” packaging any more.`, ref);
  try {
    const { batch, movement } = receiveDirect(actor, {
      productId: resolved.product.id,
      supplierId: input.supplierId,
      quantity: input.quantity,
      packagingId: level.id,
      unitCost: input.unitCost,
      batchNumber: input.batchNumber,
      manufacturingDate: input.manufacturingDate,
      expiryDate: input.expiryDate,
      invoiceNumber: input.invoiceNumber,
      purchaseReference: input.purchaseReference,
      reason: `Received offline on “${device.name}” at ${new Date(at).toLocaleString("en-NG")} (${ref})${input.note ? `: ${input.note}` : ""}`,
    });
    return { status: "APPLIED", serverRef: { productId: resolved.product.id, batchId: batch.id, movementId: movement.id, number: movement.reference }, localReference: ref };
  } catch (error) {
    if (!isDomain(error)) throw error;
    const message = (error as Error).message;
    // Someone received the same batch online meanwhile: a real conflict, not a mistake in the data.
    return /already been received|not a verified supplier|restricted|discontinued/i.test(message) ? conflict(message, ref) : rejected(message, ref);
  }
}

async function evaluateAdjustment(actor: Actor, device: DeviceInfo, operation: OfflineOperation): Promise<Evaluated> {
  const parsed = adjustmentSchema.safeParse(operation.payload);
  if (!parsed.success) return rejected("The adjustment data is incomplete or damaged.", null);
  const input = parsed.data;
  const ref = input.localNumber;
  const resolved = await resolveProduct(input, device.outlet_id, ref);
  if (resolved.error) return resolved.error;
  try {
    // The same approval workflow as online: the adjustment becomes a request an approver confirms.
    const movement = requestStockMovement(actor, { type: "Adjustment", productId: resolved.product.id, quantity: input.quantity, direction: input.direction, batchId: input.batchId || undefined, reason: `${input.reason} (recorded offline on “${device.name}”, ${ref})` });
    return { status: "APPLIED", serverRef: { productId: resolved.product.id, movementId: movement.id, number: movement.reference }, localReference: ref };
  } catch (error) {
    if (!isDomain(error)) throw error;
    const message = (error as Error).message;
    return /on hand|batch/i.test(message) ? conflict(message, ref) : rejected(message, ref);
  }
}

/** Checks one operation against today's data and applies it if it can be. Shared with "retry". */
export async function evaluate(actor: Actor, device: DeviceInfo, operation: OfflineOperation, at: string): Promise<Evaluated> {
  if (operation.type === "sale") return evaluateSale(actor, device, operation, at);
  if (operation.type === "product") return evaluateProduct(actor, device, operation);
  if (operation.type === "receiving") return evaluateReceiving(actor, device, operation, at);
  return evaluateAdjustment(actor, device, operation);
}

export async function applyOperation(actor: Actor, device: DeviceInfo, input: unknown): Promise<OperationOutcome> {
  const operation = operationSchema.parse(input);
  const tenantId = currentTenantId();
  const [existing] = await runSql<{ device_id: string; status: string; result: OperationOutcome }>(`SELECT device_id, status, result FROM offline_operations WHERE tenant_id = $1 AND id = $2`, [tenantId, operation.id]);
  if (existing) {
    if (existing.device_id !== device.id) throw new DomainError("This operation ID was already used by another device.", 409);
    await runSql(`UPDATE offline_operations SET attempts = attempts + 1 WHERE tenant_id = $1 AND id = $2`, [tenantId, operation.id]);
    return { ...existing.result, id: operation.id, status: "duplicate", original: STORED[existing.status] };
  }
  const time = Date.parse(operation.createdAt);
  const oldest = new Date(device.registered_at).getTime() - 60_000;
  const valid = Number.isFinite(time) && time <= Date.now() + 5 * 60_000 && time >= oldest;
  const at = valid ? new Date(time).toISOString() : new Date().toISOString();
  const result = valid ? await evaluate(actor, device, operation, at) : rejected("The device clock gave this operation an impossible time.", null);
  const outcome: OperationOutcome = { id: operation.id, status: result.status === "APPLIED" ? "applied" : result.status === "CONFLICT" ? "conflict" : "rejected", message: result.message, serverRef: result.serverRef };
  if (result.status === "CONFLICT") {
    notifyStockApprovers(device.outlet_id, "Offline record needs reconciliation", `${TYPE_LABEL[operation.type]} ${result.localReference ?? ""} from ${device.name} (${actor.name}): ${result.message}`);
    recordAudit(actor, { action: "offline.conflict", entity: "OfflineOperation", entityId: operation.id, summary: `Offline ${TYPE_LABEL[operation.type]} ${result.localReference ?? ""} from “${device.name}” kept for reconciliation: ${result.message}`, outletId: device.outlet_id, severity: "warning" });
  }
  await runSql(
    `INSERT INTO offline_operations (id, tenant_id, device_id, user_id, user_name, outlet_id, type, status, local_reference, created_offline_at, payload, result, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)`,
    [operation.id, tenantId, device.id, actor.id, actor.name, device.outlet_id, operation.type, result.status, result.localReference, at, JSON.stringify(operation.payload ?? null), JSON.stringify(outcome), result.message ?? null],
  );
  await runSql(`UPDATE offline_devices SET last_sync_at = now(), last_seen_at = now() WHERE id = $1 AND tenant_id = $2`, [device.id, tenantId]);
  return outcome;
}

/** Operations of this device settled in the reconciliation centre recently (the device then stops flagging them). */
export async function resolvedForDevice(deviceId: string) {
  const rows = await runSql<{ id: string }>(`SELECT id FROM offline_operations WHERE tenant_id = $1 AND device_id = $2 AND status = 'RESOLVED' AND resolved_at > now() - interval '14 days'`, [currentTenantId(), deviceId]);
  return rows.map((row) => row.id);
}
