// Reports available offline. They are snapshots, always shown with the time they describe; nothing here is
// presented as live. Stock and expiry come from the stock downloaded to this device; sales figures from the
// server snapshot taken at the last download, plus the sales made on this device since then.

import { offlineDatabase, type DeviceRecord } from "@/lib/offline/db";
import type { OfflineSale } from "@/lib/offline/till";

export type OfflineReports = {
  stockAsOf: string | null;
  lowStock: { name: string; units: number; minStock: number; baseUnit: string }[];
  nearExpiry: { name: string; batchNumber: string; expiryDate: string; units: number; days: number }[];
  expired: { name: string; batchNumber: string; expiryDate: string; units: number }[];
  sales: { asOf: string; days: { date: string; count: number; total: number }[]; todayByMethod: Record<string, number> } | null;
  deviceSalesSince: { count: number; total: number; pending: number };
};

export async function offlineReports(record: DeviceRecord): Promise<OfflineReports> {
  const db = offlineDatabase(record.tenantId, record.userId);
  const settings = ((await db.lists.get("settings"))?.value ?? {}) as { nearExpiryDays?: number };
  const products = new Map((await db.products.toArray()).filter((product) => !product.pendingSync).map((product) => [product.id, product]));
  const batches = await db.batches.toArray();
  const today = new Date().toISOString().slice(0, 10);
  const nearDays = settings.nearExpiryDays ?? 90;
  const usable = new Map<string, number>();
  const nearExpiry: OfflineReports["nearExpiry"] = [];
  const expired: OfflineReports["expired"] = [];
  for (const batch of batches) {
    const product = products.get(batch.productId);
    if (!product) continue;
    const units = Number(batch.availableQuantity ?? 0);
    const expiry = String(batch.expiryDate);
    const days = Math.round((Date.parse(expiry) - Date.parse(today)) / 86_400_000);
    if (expiry <= today) expired.push({ name: String(product.name), batchNumber: String(batch.batchNumber), expiryDate: expiry, units });
    else {
      if (!batch.blocked) usable.set(product.id, (usable.get(product.id) ?? 0) + units);
      if (days <= nearDays) nearExpiry.push({ name: String(product.name), batchNumber: String(batch.batchNumber), expiryDate: expiry, units, days });
    }
  }
  const lowStock = [...products.values()]
    .map((product) => ({ name: String(product.name), units: usable.get(product.id) ?? 0, minStock: Number(product.minStock ?? 0), baseUnit: String(product.baseUnit ?? "unit") }))
    .filter((row) => row.minStock > 0 && row.units <= row.minStock)
    .sort((a, b) => a.units / a.minStock - b.units / b.minStock);
  const server = (await db.reports.get("server")) as { generatedAt: string; value: { sales: Omit<NonNullable<OfflineReports["sales"]>, "asOf"> | null } } | undefined;
  const sales = (await db.sales.toArray()) as unknown as OfflineSale[];
  const since = server?.generatedAt ?? "";
  const after = sales.filter((sale) => sale.createdAt > since);
  return {
    stockAsOf: record.lastPackageAt,
    lowStock,
    nearExpiry: nearExpiry.sort((a, b) => a.days - b.days),
    expired,
    sales: server?.value.sales ? { asOf: server.generatedAt, ...server.value.sales } : null,
    deviceSalesSince: { count: after.length, total: Math.round(after.reduce((sum, sale) => sum + sale.total, 0) * 100) / 100, pending: after.filter((sale) => sale.syncStatus !== "synced").length },
  };
}
