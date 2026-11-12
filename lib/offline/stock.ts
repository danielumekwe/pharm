// Offline inventory records: new products, stock receipts (each its own batch) and stock adjustments.
// Each record and its upload-queue entry are written in one IndexedDB transaction with the same UUID. A receipt
// or adjustment for a product created on this device depends on that product's upload, which goes first;
// the server links them. The server applies its normal rules again on upload (registerProduct, receiveDirect,
// the adjustment approval workflow).

import { offlineDatabase, type DeviceRecord, type QueueItem } from "@/lib/offline/db";

const db = (record: DeviceRecord) => offlineDatabase(record.tenantId, record.userId);
const today = () => new Date().toISOString().slice(0, 10);

async function nextLocalNumber(record: DeviceRecord, prefix: string) {
  const local = db(record);
  const counter = ((await local.meta.get("recordCounter")) as { key: string; value: number } | undefined)?.value ?? 0;
  await local.meta.put({ key: "recordCounter", value: counter + 1 });
  return `${prefix}-${record.deviceId.replace(/^dev-/, "").slice(0, 6).toUpperCase()}-${String(counter + 1).padStart(4, "0")}`;
}

function queueItem(record: DeviceRecord, id: string, type: QueueItem["type"], payload: unknown, dependsOn: string[] = []): QueueItem {
  return { id, tenantId: record.tenantId, outletId: record.outletId, userId: record.userId, deviceId: record.deviceId, type, createdAt: new Date().toISOString(), dependsOn, retries: 0, status: "pending", payload };
}

function requirePermission(record: DeviceRecord, permission: string, what: string) {
  if (!record.permissions.includes(permission)) throw new Error(`Your account cannot ${what}.`);
}

/** Product reference for the server: an ID, or the offline operation that creates it on this device. */
function productReference(productId: string) {
  return productId.startsWith("local:") ? { productRef: productId.slice("local:".length), dependsOn: [productId.slice("local:".length)] } : { productId, dependsOn: [] as string[] };
}

// ---------------------------------------------------------------- new product

export type NewProductInput = {
  name: string;
  genericName?: string;
  category: string;
  dosageForm?: string;
  strength?: string;
  manufacturer?: string;
  baseUnit: string;
  packName?: string;
  packSize?: number;
  /** Per base unit. */
  purchasePrice: number;
  sellingPrice: number;
  barcode?: string;
  minStock?: number;
};

export async function createOfflineProduct(record: DeviceRecord, input: NewProductInput) {
  requirePermission(record, "products.manage", "register products");
  const local = db(record);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new Error("Product name is required.");
  const catalog = ((await local.lists.get("catalog"))?.value ?? { categories: [] }) as { categories: string[]; dosageForms: string[] };
  if (!catalog.categories.includes(input.category)) throw new Error("Choose a category from the list.");
  if (!input.baseUnit.trim()) throw new Error("Enter the base unit, e.g. Tablet.");
  if (!(input.purchasePrice > 0) || !(input.sellingPrice > 0)) throw new Error("Enter the purchase and selling prices per base unit.");
  if (input.sellingPrice < input.purchasePrice) throw new Error("The selling price cannot be below cost.");
  const clash = await local.products.filter((product) => String(product.name).toLowerCase() === name.toLowerCase()).first();
  if (clash) throw new Error(`${name} is already in the catalogue on this device.`);
  const packaging = input.packSize && input.packSize > 1 ? [{ name: input.packName?.trim() || "Pack", contains: Math.floor(input.packSize) }, { name: input.baseUnit.trim(), contains: 1 }] : [{ name: input.baseUnit.trim(), contains: 1 }];
  const id = crypto.randomUUID();
  return local.transaction("rw", [local.products, local.queue, local.meta], async () => {
    const localNumber = await nextLocalNumber(record, "OPR");
    const payload = { localNumber, name, genericName: input.genericName?.trim() || undefined, category: input.category, dosageForm: input.dosageForm || undefined, strength: input.strength?.trim() || undefined, manufacturer: input.manufacturer?.trim() || undefined, packaging, purchasePrice: input.purchasePrice, sellingPrice: input.sellingPrice, barcode: input.barcode?.trim() || undefined, minStock: input.minStock };
    // Shown on the device (to receive stock against it) but not sold until the server has created it.
    await local.products.put({
      id: `local:${id}`,
      outletId: record.outletId,
      name,
      genericName: payload.genericName,
      sku: null,
      category: input.category,
      baseUnit: input.baseUnit.trim(),
      barcodes: payload.barcode ? [payload.barcode] : [],
      barcodeLevels: [],
      packaging: packaging.map((level, index) => ({ id: `local:${id}:${index}`, name: level.name, contains: level.contains, unitsPerPackage: index === 0 && packaging.length > 1 ? level.contains : 1, isBase: index === packaging.length - 1, sellable: false, sellingPrice: null, minSellingPrice: null })),
      sellingPrice: input.sellingPrice,
      minSellingPrice: null,
      status: "PENDING",
      lifecycle: "PENDING",
      rxOnly: false,
      pendingSync: true,
      localNumber,
    });
    await local.queue.put(queueItem(record, id, "product", payload));
    return { id: `local:${id}`, localNumber };
  });
}

// ---------------------------------------------------------------- stock receipt

export type ReceivingInput = {
  productId: string;
  supplierId: string;
  packagingName: string;
  quantity: number;
  /** Cost per package of that level. */
  unitCost: number;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  invoiceNumber?: string;
  note?: string;
};

export async function receiveOffline(record: DeviceRecord, input: ReceivingInput) {
  requirePermission(record, "purchase.receive", "receive stock");
  const local = db(record);
  const product = await local.products.get(input.productId);
  if (!product) throw new Error("Choose a product.");
  const level = (product.packaging as { name: string; unitsPerPackage: number }[]).find((row) => row.name === input.packagingName);
  if (!level) throw new Error("Choose the packaging the quantity is counted in.");
  if (!(await local.suppliers.get(input.supplierId))) throw new Error("Choose a supplier.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error("Quantity must be a positive whole number.");
  if (!(input.unitCost > 0)) throw new Error("Enter the cost per package.");
  const batchNumber = input.batchNumber.trim().toUpperCase();
  if (!batchNumber) throw new Error("Batch number is required. Each batch is received separately.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.manufacturingDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) throw new Error("Manufacturing and expiry dates are required.");
  if (input.manufacturingDate > today()) throw new Error("Manufacturing date cannot be in the future.");
  if (input.expiryDate <= input.manufacturingDate) throw new Error("Expiry must be after the manufacturing date.");
  const settings = ((await local.lists.get("settings"))?.value ?? {}) as { minShelfLifeDays?: number };
  const minimum = new Date(Date.now() + (settings.minShelfLifeDays ?? 0) * 86_400_000).toISOString().slice(0, 10);
  if (input.expiryDate < minimum) throw new Error(`Short-dated stock (under ${settings.minShelfLifeDays} days to expiry) must be rejected at receipt.`);
  const known = await local.batches.where("productId").equals(input.productId).filter((batch) => String(batch.batchNumber).toUpperCase() === batchNumber).first();
  const pendingSame = await local.receivings.filter((row) => (row as unknown as { productId: string; batchNumber: string }).productId === input.productId && (row as unknown as { batchNumber: string }).batchNumber === batchNumber && row.syncStatus !== "attention").first();
  if (known || pendingSame) throw new Error(`Batch ${batchNumber} of ${product.name} has already been received. Batches are never merged.`);
  const reference = productReference(input.productId);
  const id = crypto.randomUUID();
  return local.transaction("rw", [local.receivings, local.queue, local.meta], async () => {
    const localNumber = await nextLocalNumber(record, "ORC");
    const createdAt = new Date().toISOString();
    const baseQuantity = input.quantity * level.unitsPerPackage;
    const payload = { localNumber, productId: reference.productId, productRef: reference.productRef, productName: product.name, supplierId: input.supplierId, quantity: input.quantity, packagingName: level.name, unitCost: input.unitCost, batchNumber, manufacturingDate: input.manufacturingDate, expiryDate: input.expiryDate, invoiceNumber: input.invoiceNumber?.trim() || undefined, note: input.note?.trim() || undefined };
    await local.receivings.put({ id, tenantId: record.tenantId, outletId: record.outletId, userId: record.userId, deviceId: record.deviceId, createdAt, syncStatus: "pending", ...payload, productId: input.productId, baseQuantity } as never);
    await local.queue.put(queueItem(record, id, "receiving", payload, reference.dependsOn));
    return { id, localNumber, baseQuantity };
  });
}

/** Base units received on this device and not yet uploaded (counted as available for offline selling). */
export async function pendingReceived(record: DeviceRecord, productId: string) {
  const rows = (await db(record).receivings.where("syncStatus").anyOf(["pending", "uploading", "failed"]).toArray()) as unknown as { productId: string; baseQuantity: number; expiryDate: string }[];
  return rows.filter((row) => row.productId === productId && row.expiryDate > today()).reduce((sum, row) => sum + row.baseQuantity, 0);
}

// ---------------------------------------------------------------- stock adjustment

export type AdjustmentInput = { productId: string; batchId?: string; direction: "IN" | "OUT"; quantity: number; reason: string };

/** Recorded offline; on upload it becomes an adjustment request that an approver confirms (as online). */
export async function adjustOffline(record: DeviceRecord, input: AdjustmentInput) {
  requirePermission(record, "stock.request", "adjust stock");
  const local = db(record);
  const product = await local.products.get(input.productId);
  if (!product) throw new Error("Choose a product.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error("Quantity must be a positive whole number of base units.");
  if (input.reason.trim().length < 3) throw new Error("Give the reason for the adjustment.");
  if (input.direction === "IN" && !input.batchId) throw new Error("Choose the batch the counted stock belongs to.");
  if (input.batchId && !(await local.batches.get(input.batchId))) throw new Error("Choose a batch of this product.");
  const reference = productReference(input.productId);
  const id = crypto.randomUUID();
  return local.transaction("rw", [local.adjustments, local.queue, local.meta], async () => {
    const localNumber = await nextLocalNumber(record, "OAD");
    const payload = { localNumber, productId: reference.productId, productRef: reference.productRef, productName: String(product.name), batchId: input.batchId || undefined, direction: input.direction, quantity: input.quantity, reason: input.reason.trim() };
    await local.adjustments.put({ id, tenantId: record.tenantId, outletId: record.outletId, userId: record.userId, deviceId: record.deviceId, createdAt: new Date().toISOString(), syncStatus: "pending", ...payload, productId: input.productId } as never);
    await local.queue.put(queueItem(record, id, "adjustment", payload, reference.dependsOn));
    return { id, localNumber };
  });
}

export type OfflineRecord = { id: string; kind: "product" | "receiving" | "adjustment"; localNumber: string; createdAt: string; summary: string; status: QueueItem["status"]; message?: string; serverNumber?: string };

/** Products, receipts and adjustments made on this device, with their upload status. */
export async function offlineRecords(record: DeviceRecord): Promise<OfflineRecord[]> {
  const local = db(record);
  const queue = new Map((await local.queue.toArray()).map((item) => [item.id, item]));
  const rows: OfflineRecord[] = [];
  for (const item of queue.values()) {
    if (item.type === "sale") continue;
    const payload = item.payload as Record<string, unknown>;
    const summary =
      item.type === "product"
        ? `${payload.name} (${payload.category})`
        : item.type === "receiving"
          ? `${payload.quantity} ${payload.packagingName} × ${payload.productName}, batch ${payload.batchNumber}, exp ${payload.expiryDate}`
          : `${payload.direction === "IN" ? "+" : "−"}${payload.quantity} × ${payload.productName}: ${payload.reason}`;
    rows.push({ id: item.id, kind: item.type as OfflineRecord["kind"], localNumber: String(payload.localNumber), createdAt: item.createdAt, summary, status: item.status, message: item.lastError });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
