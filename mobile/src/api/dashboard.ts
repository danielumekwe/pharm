import { ApiClient } from './client';
import type { Dashboard } from '../types';

export async function getDashboard(
  client: ApiClient,
  filters?: { from?: string; to?: string; outlet?: string; trend?: string },
): Promise<Dashboard> {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.outlet) params.set('outlet', filters.outlet);
  if (filters?.trend) params.set('trend', filters.trend);
  const query = params.toString();
  const { data } = await client.get(`/api/dashboard${query ? `?${query}` : ''}`);
  return data as Dashboard;
}
