import { ApiClient } from './client';
import type { SalesHistory } from '../types';

export interface SalesFilters {
  from?: string;
  to?: string;
  outletId?: string;
  cashierId?: string;
  method?: string;
  status?: string;
}

export async function getSalesHistory(client: ApiClient, filters: SalesFilters = {}): Promise<SalesHistory> {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.outletId) params.set('outletId', filters.outletId);
  if (filters.cashierId) params.set('cashierId', filters.cashierId);
  if (filters.method) params.set('method', filters.method);
  if (filters.status) params.set('status', filters.status);
  const query = params.toString();
  const { data } = await client.get(`/api/sales${query ? `?${query}` : ''}`);
  return data as SalesHistory;
}

export async function getSaleDetail(client: ApiClient, id: string): Promise<unknown> {
  const { data } = await client.get(`/api/sales/${id}/receipt`);
  return data;
}

export async function voidSale(client: ApiClient, id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const { status, data } = await client.patch(`/api/sales/${id}`, { action: 'void', reason });
  if (status === 200) return { ok: true };
  return { ok: false, error: (data as { error?: string }).error };
}

export async function createReturn(
  client: ApiClient,
  saleId: string,
  lines: { saleLineId: string; quantity: number; reason: string }[],
): Promise<{ ok: boolean; error?: string }> {
  const { status, data } = await client.post(`/api/sales/${saleId}/returns`, { lines });
  if (status === 201) return { ok: true };
  return { ok: false, error: (data as { error?: string }).error };
}
