import { ApiClient } from './client';
import type { StockLevelRow, Transfer } from '../types';

// ---- Stock levels (read-only, for sales roles)

export async function getStockLevels(client: ApiClient): Promise<StockLevelRow[]> {
  const { data } = await client.get('/api/stock-levels');
  return data as StockLevelRow[];
}

// ---- Products (inventory roles only)

export async function getProducts(client: ApiClient): Promise<unknown[]> {
  const { data } = await client.get('/api/products');
  return data as unknown[];
}

export async function getProductDetail(client: ApiClient, id: string): Promise<unknown> {
  const { data } = await client.get(`/api/products/${id}`);
  return data;
}

export async function lookupBarcodeFull(client: ApiClient, code: string, outletId: string): Promise<unknown> {
  const { data } = await client.get(`/api/barcodes?code=${encodeURIComponent(code)}&outletId=${encodeURIComponent(outletId)}`);
  return data;
}

// ---- Stock receiving (batches)

export interface BatchInput {
  productId: string;
  batchNumber: string;
  expiryDate: string;
  manufacturingDate?: string;
  packagingIndex: number;
  quantity: number;
  unitCost?: number;
  purchaseOrderId?: string;
}

export async function receiveBatch(client: ApiClient, input: BatchInput): Promise<{ ok: boolean; error?: string }> {
  const { status, data } = await client.post('/api/batches', input);
  if (status === 201) return { ok: true };
  return { ok: false, error: (data as { error?: string }).error };
}

// ---- Stock movements

export async function getStockLedger(client: ApiClient): Promise<unknown[]> {
  const { data } = await client.get('/api/stock-ledger');
  return data as unknown[];
}

export async function getStockMovements(client: ApiClient): Promise<unknown[]> {
  const { data } = await client.get('/api/stock-movements');
  return data as unknown[];
}

export async function approveMovement(
  client: ApiClient,
  id: string,
  status: 'Approved' | 'Rejected',
): Promise<{ ok: boolean; error?: string }> {
  const { status: httpStatus, data } = await client.patch(`/api/inventory/${id}`, { status });
  if (httpStatus === 200) return { ok: true };
  return { ok: false, error: (data as { error?: string }).error };
}

// ---- Alerts

export async function getAlerts(client: ApiClient): Promise<unknown[]> {
  const { data } = await client.get('/api/alerts');
  return data as unknown[];
}
