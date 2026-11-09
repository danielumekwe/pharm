// Talks to the PharmaERP server with the app's bearer token (issued by /api/mobile/login).
// Every request carries the token; the server applies the same permissions and pharmacy as on the web.
import Constants from 'expo-constants';

// EXPO_PUBLIC_API_URL points a development build at a local server; release builds use app.json's apiUrl.
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || ((Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'https://www.pharmerp.name.ng');

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Set by the auth provider: the token for requests, and what to do when the server rejects it. */
export function configureApi(next: { token: string | null; onUnauthorized?: () => void }) {
  token = next.token;
  if (next.onUnauthorized) onUnauthorized = next.onUnauthorized;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    if (response.status === 401 && init.auth !== false && token) onUnauthorized?.();
    throw new ApiError(response.status, typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`, body);
  }
  return body as T;
}
