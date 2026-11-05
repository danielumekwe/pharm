/**
 * Auth flow — mirrors tests/helpers/client.mjs exactly:
 *   1. GET /api/auth/csrf → csrfToken
 *   2. POST /api/auth/callback/credentials (form-urlencoded)
 *   3. GET /api/auth/session → user
 *   4. POST /api/auth/signout (sign out)
 *   5. POST /api/session/outlet {outletId} (switch outlet)
 */
import { ApiClient } from './client';
import { BASE_URL } from '../config';
import type { SessionUser } from '../types';

export async function getCsrfToken(client: ApiClient): Promise<string> {
  const { data } = await client.get('/api/auth/csrf');
  return (data as { csrfToken: string }).csrfToken;
}

/**
 * Sign in with credentials provider.
 * Returns null on success, or an error string on failure.
 */
export async function signIn(
  client: ApiClient,
  identifier: string,
  password: string,
  outletId: string,
): Promise<string | null> {
  const csrfToken = await getCsrfToken(client);
  const params = new URLSearchParams({
    csrfToken,
    identifier,
    password,
    outletId,
    json: 'true',
  });

  const response = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: [...client.getCookies()].map(([k, v]) => `${k}=${v}`).join('; '),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  // Merge cookies from response
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    // Update the client's cookies by piggybacking on its request mechanism
    const cookies = client.getCookies();
    const headers = setCookie.split(/,(?=[^ ])/);
    for (const header of headers) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /Max-Age=0/i.test(header)) {
        cookies.delete(name);
      } else {
        cookies.set(name, value);
      }
    }
    // Re-assign via a workaround: cast to access private map
    (client as unknown as { cookies: Map<string, string> }).cookies = cookies;
  }

  const location =
    response.headers.get('location') ??
    (await response.json().catch(() => ({}))).url ??
    '';

  try {
    const error = new URL(location, BASE_URL).searchParams.get('error');
    return error;
  } catch {
    return null;
  }
}

export async function getSession(client: ApiClient): Promise<SessionUser | null> {
  const { data } = await client.get('/api/auth/session');
  const session = data as { user?: SessionUser } | null;
  return session?.user ?? null;
}

export async function signOut(client: ApiClient): Promise<void> {
  await client.post('/api/auth/signout');
}

/** Switch the active outlet. Call getSession() after to refresh user data. */
export async function switchOutlet(client: ApiClient, outletId: string): Promise<void> {
  await client.post('/api/session/outlet', { outletId });
}
