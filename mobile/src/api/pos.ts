import { ApiClient } from './client';
import type { PosCatalogItem, HeldSale, SaleResult, PaymentTender, BasketLine } from '../types';

export async function getCatalog(client: ApiClient, outletId: string): Promise<PosCatalogItem[]> {
  const { data } = await client.get(`/api/pos/catalog?outletId=${encodeURIComponent(outletId)}`);
  return data as PosCatalogItem[];
}

export async function lookupBarcode(client: ApiClient, code: string, outletId: string): Promise<PosCatalogItem | null> {
  const catalog = await getCatalog(client, outletId);
  return catalog.find(item =>
    item.barcodes.includes(code) ||
    item.packaging.some(p => p.barcodes.includes(code))
  ) ?? null;
}

// ---- Held baskets

export interface HeldInput {
  kind: 'HELD' | 'DRAFT';
  outletId: string;
  label?: string;
  cart: { lines: { productId: string; quantity: number; packagingId?: string }[] };
}

export async function getHeld(client: ApiClient, outletId: string): Promise<HeldSale[]> {
  const { data } = await client.get(`/api/pos/held?outletId=${encodeURIComponent(outletId)}`);
  return (data as { id: string; reference: string; kind: string; label?: string; updatedAt: string; cart: { lines: unknown[] } }[]).map(row => ({
    id: row.id,
    reference: row.reference,
    kind: row.kind as 'HELD' | 'DRAFT',
    label: row.label,
    lines: row.cart.lines.length,
    updatedAt: row.updatedAt,
  }));
}

export async function saveHeld(client: ApiClient, input: HeldInput): Promise<{ id: string; reference: string }> {
  const { data } = await client.post('/api/pos/held', input);
  return data as { id: string; reference: string };
}

export async function deleteHeld(client: ApiClient, id: string): Promise<void> {
  await client.del(`/api/pos/held/${id}`);
}

// ---- Create sale

export interface SaleInput {
  outletId: string;
  customerId: string | null;
  walkIn?: { name: string; phone: string };
  lines: {
    productId: string;
    packagingId?: string;
    quantity: number;
    discount?: { type: 'percent' | 'amount'; value: number };
  }[];
  globalDiscount?: { type: 'percent' | 'amount'; value: number } | null;
  payments: PaymentTender[];
  prescriptionRef?: string;
  heldId?: string;
  customerKind?: string;
}

export async function createSale(client: ApiClient, input: SaleInput): Promise<{ ok: true; sale: SaleResult } | { ok: false; error: string; status: number }> {
  const { status, data } = await client.post('/api/sales', input);
  if (status === 201) {
    return { ok: true, sale: data as SaleResult };
  }
  return { ok: false, error: (data as { error?: string }).error ?? 'Sale failed', status };
}

// ---- Receipt

export async function getReceipt(client: ApiClient, saleId: string): Promise<unknown> {
  const { data } = await client.get(`/api/sales/${saleId}/receipt`);
  return data;
}

export async function getReceiptPdfUrl(saleId: string): Promise<string> {
  return `/api/sales/${saleId}/receipt?format=pdf&print=1`;
}
