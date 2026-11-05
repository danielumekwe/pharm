import { ApiClient } from './client';
import type { Notification } from '../types';

export async function getNotifications(client: ApiClient): Promise<Notification[]> {
  const { data } = await client.get('/api/notifications');
  return data as Notification[];
}

export async function markNotificationRead(client: ApiClient, id: string): Promise<void> {
  await client.patch(`/api/notifications/${id}`, { read: true });
}

export async function markAllRead(client: ApiClient): Promise<void> {
  await client.patch('/api/notifications', { readAll: true });
}
