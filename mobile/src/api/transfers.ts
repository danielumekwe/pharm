import { ApiClient } from './client';
import type { Transfer } from '../types';

export async function getTransfers(client: ApiClient): Promise<Transfer[]> {
  const { data } = await client.get('/api/transfers');
  return data as Transfer[];
}

export async function getTransfer(client: ApiClient, id: string): Promise<Transfer> {
  const { data } = await client.get(`/api/transfers/${id}`);
  return data as Transfer;
}

export interface CreateTransferInput {
  fromOutletId: string;
  toOutletId: string;
  lines: { productId: string; quantity: number }[];
  notes?: string;
}

export async function createTransfer(
  client: ApiClient,
  input: CreateTransferInput,
): Promise<{ ok: boolean; transfer?: Transfer; error?: string }> {
  const { status, data } = await client.post('/api/transfers', input);
  if (status === 201) return { ok: true, transfer: data as Transfer };
  return { ok: false, error: (data as { error?: string }).error };
}

export type TransferAction = 'approve' | 'reject' | 'dispatch' | 'receive' | 'cancel';

export async function updateTransfer(
  client: ApiClient,
  id: string,
  payload: { action: TransferAction; lines?: unknown[]; final?: boolean; note?: string },
): Promise<{ ok: boolean; transfer?: Transfer; error?: string }> {
  const { status, data } = await client.patch(`/api/transfers/${id}`, payload);
  if (status === 200) return { ok: true, transfer: data as Transfer };
  return { ok: false, error: (data as { error?: string }).error };
}
