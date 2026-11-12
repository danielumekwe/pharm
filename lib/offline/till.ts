// The offline till: sells from the data on the device. Prices, discounts and VAT use the same arithmetic as
// the server (lib/erp/sale-pricing.ts); the server checks everything again when the sale is uploaded.
// A completed sale and its upload-queue entry are written in ONE IndexedDB transaction, with the same UUID,
// so a sale can never exist without being queued (or be queued twice).

import { packagePrice, type PackagingLevel } from "@/lib/erp/packaging";
import { priceBasket, PricingError, type DiscountInput } from "@/lib/erp/sale-pricing";
import { offlineDatabase, type DeviceRecord, type QueueItem } from "@/lib/offline/db";
import { pendingReceived } from "@/lib/offline/stock";

export type OfflineProduct = {
  id: string;
  name: string;
  genericName?: string;
  sku: string | null;
  barcodes: string[];
  barcodeLevels: { code: string; packagingId: string | null }[];
  baseUnit: string;
  packaging: (Pick<PackagingLevel, "id" | "name" | "unitsPerPackage" | "isBase" | "sellable"> & { sellingPrice: number | null; minSellingPrice: number | null })[];
  sellingPrice: number;
  minSellingPrice: number | null;
  status: string;
  lifecycle: string;
  rxOnly: boolean;
};
export type CartLine = { productId: string; packagingId: string; quantity: number; discount?: DiscountInput };
export type Tender = { method: "Cash" | "Card" | "Transfer"; amount: number; reference?: string };

export type OfflineSale = {
  id: string;
  tenantId: string;
  outletId: string;
  userId: string;
  deviceId: string;
  localNumber: string;
  createdAt: string;
  cashier: string;
  outletName: string;
  tenantName: string;
  lines: { productId: string; productName: string; packagingId: string; packagingName: string; quantity: number; baseQuantity: number; packPrice: number; gross: number; discount: number }[];
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  payments: Tender[];
  change: number;
  paymentStatus: "Paid" | "Paid (cash); card/transfer pending verification";
  prescriptionRef?: string;
  globalDiscount?: DiscountInput;
  syncStatus: QueueItem["status"];
  serverNumber?: string;
  syncMessage?: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const db = (record: DeviceRecord) => offlineDatabase(record.tenantId, record.userId);

/** Price of one package, exactly as the server prices it (own price, else base price × units). */
export function packPriceOf(product: OfflineProduct, packagingId: string) {
  const level = product.packaging.find((row) => row.id === packagingId);
  if (!level) return null;
  return packagePrice({ ...level, contains: 1, sellingPrice: level.sellingPrice ?? undefined, minSellingPrice: level.minSellingPrice ?? undefined } as PackagingLevel, { purchasePrice: 0, sellingPrice: product.sellingPrice, minSellingPrice: product.minSellingPrice ?? undefined }, "sellingPrice") ?? product.sellingPrice * level.unitsPerPackage;
}

/** Usable base units on this device: downloaded usable batches minus offline sales not yet uploaded. */
export async function availableUnits(record: DeviceRecord, productId: string) {
  const local = db(record);
  const batches = await local.batches.where("productId").equals(productId).toArray();
  const downloaded = batches.filter((batch) => !batch.blocked).reduce((sum, batch) => sum + Number(batch.availableQuantity ?? 0), 0);
  const unsent = (await local.sales.where("syncStatus").noneOf(["synced"]).toArray()) as unknown as OfflineSale[];
  const sold = unsent.reduce((sum, sale) => sum + sale.lines.filter((line) => line.productId === productId).reduce((total, line) => total + line.baseQuantity, 0), 0);
  return downloaded - sold + (await pendingReceived(record, productId));
}

export async function searchProducts(record: DeviceRecord, text: string, limit = 30) {
  const local = db(record);
  const query = text.trim();
  if (!query) return (await local.products.orderBy("name").filter((product) => !product.pendingSync).limit(limit).toArray()) as unknown as OfflineProduct[];
  const byCode = (await local.products.where("barcodes").equals(query).toArray()) as unknown as OfflineProduct[];
  if (byCode.length) return byCode;
  const needle = query.toLowerCase();
  return ((await local.products.filter((product) => String(product.name).toLowerCase().includes(needle) || String(product.sku ?? "").toLowerCase() === needle || String(product.genericName ?? "").toLowerCase().includes(needle)).limit(limit).toArray()) as unknown as OfflineProduct[]);
}

/** Package a scanned barcode stands for (a carton barcode adds a carton). */
export function levelForBarcode(product: OfflineProduct, code: string) {
  const tagged = product.barcodeLevels.find((row) => row.code === code);
  return tagged?.packagingId ?? product.packaging.find((level) => level.isBase)?.id ?? product.packaging[0]?.id;
}

export type SaleCheck = {
  lines: OfflineSale["lines"];
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  discountPct: number;
  problems: string[];
  /** Over the downloaded stock, allowed by the pharmacy's policy (reconciled when uploaded). */
  stockWarnings: string[];
  needsRx: boolean;
};

/** Prices the cart and lists anything that stops the sale, using the downloaded settings and permissions. */
export async function checkCart(record: DeviceRecord, cart: CartLine[], globalDiscount?: DiscountInput): Promise<SaleCheck> {
  const local = db(record);
  const settings = ((await local.lists.get("settings"))?.value ?? { vatRate: 0, pos: { cashierMaxDiscountPct: 0, approverMaxDiscountPct: 0 } }) as { vatRate: number; pos: { cashierMaxDiscountPct: number; approverMaxDiscountPct: number } };
  const policy = ((await local.lists.get("policy"))?.value ?? { stockPolicy: "cached-limit" }) as { stockPolicy: "cached-limit" | "allow-negative" };
  const problems: string[] = [];
  const stockWarnings: string[] = [];
  const productsById = new Map<string, OfflineProduct>();
  for (const line of cart) {
    const product = (await local.products.get(line.productId)) as unknown as OfflineProduct | undefined;
    if (product) productsById.set(product.id, product);
  }
  const usable = cart.filter((line) => productsById.has(line.productId));
  const prices = usable.map((line) => packPriceOf(productsById.get(line.productId)!, line.packagingId) ?? 0);
  let priced;
  try {
    priced = priceBasket({ lines: usable.map((line, index) => ({ packPrice: prices[index], quantity: line.quantity, discount: line.discount })), globalDiscount, vatRate: settings.vatRate });
  } catch (error) {
    if (error instanceof PricingError) return { lines: [], subtotal: 0, discount: 0, vat: 0, total: 0, discountPct: 0, problems: [error.message], stockWarnings, needsRx: false };
    throw error;
  }
  const units = new Map<string, number>();
  const lines = usable.map((line, index) => {
    const product = productsById.get(line.productId)!;
    const level = product.packaging.find((row) => row.id === line.packagingId)!;
    if (!level?.sellable) problems.push(`${product.name} is not sold by the ${level?.name.toLowerCase() ?? "package"}.`);
    if (product.status === "RESTRICTED" || product.lifecycle !== "ACTIVE") problems.push(`${product.name} cannot be sold.`);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) problems.push(`Invalid quantity for ${product.name}.`);
    const baseQuantity = line.quantity * (level?.unitsPerPackage ?? 1);
    units.set(product.id, (units.get(product.id) ?? 0) + baseQuantity);
    const row = priced.lines[index];
    const minimum = level?.minSellingPrice ?? (product.minSellingPrice ? round2(product.minSellingPrice * (level?.unitsPerPackage ?? 1)) : null);
    if (minimum && (row.gross - row.discount) / line.quantity < minimum - 0.005) problems.push(`${product.name}: the discount takes the price below the minimum of ₦${minimum.toLocaleString()}.`);
    return { productId: product.id, productName: product.name, packagingId: line.packagingId, packagingName: level?.name ?? "", quantity: line.quantity, baseQuantity, packPrice: prices[index], gross: row.gross, discount: row.discount };
  });
  if (usable.length < cart.length) problems.push("An item in the cart is no longer in the downloaded catalogue.");
  for (const [productId, needed] of units) {
    const available = await availableUnits(record, productId);
    if (needed > available) {
      const message = `${productsById.get(productId)!.name}: ${needed} needed, ${Math.max(0, available)} known on this device.`;
      if (policy.stockPolicy === "cached-limit") problems.push(`${message} Offline sales cannot exceed the stock this device last downloaded.`);
      else stockWarnings.push(`${message} The sale will be checked when it is uploaded.`);
    }
  }
  const canDiscount = record.permissions.includes("sales.discount");
  const limit = canDiscount ? settings.pos.approverMaxDiscountPct : settings.pos.cashierMaxDiscountPct;
  if (priced.discountPct > limit + 0.001) problems.push(`Discount is above your ${limit}% limit.`);
  if (!record.permissions.includes("sales.create")) problems.push("Your account cannot make sales.");
  return { lines, subtotal: priced.subtotal, discount: priced.discount, vat: priced.vat, total: priced.total, discountPct: priced.discountPct, problems, stockWarnings, needsRx: lines.some((line) => productsById.get(line.productId)?.rxOnly) };
}

/** Completes an offline sale: stores it and queues it for upload, atomically. */
export async function completeOfflineSale(record: DeviceRecord, input: { cart: CartLine[]; globalDiscount?: DiscountInput; payments: Tender[]; prescriptionRef?: string }) {
  const check = await checkCart(record, input.cart, input.globalDiscount);
  if (!check.lines.length) throw new Error("Add at least one item.");
  if (check.problems.length) throw new Error(check.problems[0]);
  if (check.needsRx && !input.prescriptionRef?.trim()) throw new Error("This sale contains prescription-only medicines. Enter the prescription reference.");
  const payments = input.payments.filter((tender) => tender.amount > 0).map((tender) => ({ ...tender, amount: round2(tender.amount), reference: tender.reference?.trim() || undefined }));
  const received = round2(payments.reduce((sum, tender) => sum + tender.amount, 0));
  const cash = payments.filter((tender) => tender.method === "Cash").reduce((sum, tender) => sum + tender.amount, 0);
  if (received < check.total - 0.001) throw new Error(`Payment is ₦${round2(check.total - received).toLocaleString()} short. Offline sales must be paid in full.`);
  const over = round2(received - check.total);
  if (over > cash + 0.001) throw new Error("Card and transfer payments cannot exceed the amount due.");
  // Cash over-tendered is change: the recorded cash tender is reduced by it, like the online till.
  let excess = over;
  const settled = payments
    .map((tender) => {
      if (tender.method !== "Cash" || excess <= 0) return tender;
      const reduce = Math.min(tender.amount, excess);
      excess = round2(excess - reduce);
      return { ...tender, amount: round2(tender.amount - reduce) };
    })
    .filter((tender) => tender.amount > 0);

  const local = db(record);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const sale = await local.transaction("rw", [local.sales, local.queue, local.meta], async () => {
    const counter = ((await local.meta.get("saleCounter")) as { key: string; value: number } | undefined)?.value ?? 0;
    await local.meta.put({ key: "saleCounter", value: counter + 1 });
    const localNumber = `OFF-${record.deviceId.replace(/^dev-/, "").slice(0, 6).toUpperCase()}-${String(counter + 1).padStart(4, "0")}`;
    const outletName = record.outletName;
    const sale: OfflineSale = {
      id,
      tenantId: record.tenantId,
      outletId: record.outletId,
      userId: record.userId,
      deviceId: record.deviceId,
      localNumber,
      createdAt,
      cashier: record.userName,
      outletName,
      tenantName: record.tenantName,
      lines: check.lines,
      subtotal: check.subtotal,
      discount: check.discount,
      vat: check.vat,
      total: check.total,
      payments: settled,
      change: over,
      paymentStatus: settled.some((tender) => tender.method !== "Cash") ? "Paid (cash); card/transfer pending verification" : "Paid",
      prescriptionRef: input.prescriptionRef?.trim() || undefined,
      globalDiscount: input.globalDiscount,
      syncStatus: "pending",
    };
    await local.sales.put(sale as never);
    const item: QueueItem = {
      id,
      tenantId: record.tenantId,
      outletId: record.outletId,
      userId: record.userId,
      deviceId: record.deviceId,
      type: "sale",
      createdAt,
      dependsOn: [],
      retries: 0,
      status: "pending",
      payload: {
        localNumber,
        outletId: record.outletId,
        customerId: null,
        prescriptionRef: sale.prescriptionRef,
        lines: check.lines.map((line, index) => ({ productId: line.productId, productName: line.productName, packagingId: line.packagingId, quantity: line.quantity, packPrice: line.packPrice, discount: input.cart[index]?.discount })),
        globalDiscount: input.globalDiscount,
        payments: settled.length ? settled : [{ method: "Cash", amount: 0 }],
        totals: { subtotal: sale.subtotal, discount: sale.discount, vat: sale.vat, total: sale.total },
      },
    };
    await local.queue.put(item);
    return sale;
  });
  // Ask the browser to wake the app when the connection returns (Background Sync, where supported).
  void navigator.serviceWorker?.ready
    .then((registration) => (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register("pharmaerp-sync"))
    .catch(() => undefined);
  return sale;
}

export async function offlineSales(record: DeviceRecord, limit = 200) {
  return ((await db(record).sales.orderBy("createdAt").reverse().limit(limit).toArray()) as unknown as OfflineSale[]);
}

export async function saveDraft(record: DeviceRecord, cart: CartLine[], label: string) {
  const id = crypto.randomUUID();
  await db(record).drafts.put({ id, tenantId: record.tenantId, outletId: record.outletId, userId: record.userId, deviceId: record.deviceId, createdAt: new Date().toISOString(), cart: { lines: cart, label } });
  return id;
}

export async function listDrafts(record: DeviceRecord) {
  return (await db(record).drafts.orderBy("createdAt").reverse().toArray()) as unknown as { id: string; createdAt: string; cart: { lines: CartLine[]; label: string } }[];
}

export async function deleteDraft(record: DeviceRecord, id: string) {
  await db(record).drafts.delete(id);
}
