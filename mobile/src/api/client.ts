/**
 * HTTP client with cookie jar, mirroring tests/helpers/client.mjs.
 * Cookies are stored in memory per session; the session context persists
 * them to SecureStore so they survive app restarts.
 */
import { BASE_URL } from '../config';

export class ApiClient {
  private cookies: Map<string, string>;

  constructor(cookies?: Map<string, string>) {
    this.cookies = cookies ? new Map(cookies) : new Map();
  }

  getCookies(): Map<string, string> {
    return new Map(this.cookies);
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private storeCookies(response: Response): void {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;
    // React Native's fetch may combine set-cookie headers with comma separation
    const headers = setCookie.split(/,(?=[^ ])/);
    for (const header of headers) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /Max-Age=0/i.test(header)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { raw?: boolean; formEncoded?: boolean } = {},
  ): Promise<{ status: number; data: unknown }> {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      cookie: this.cookieHeader(),
    };

    let bodyStr: string | undefined;
    if (body !== undefined) {
      if (options.formEncoded) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        bodyStr = body instanceof URLSearchParams ? body.toString() : String(body);
      } else {
        headers['Content-Type'] = 'application/json';
        bodyStr = JSON.stringify(body);
      }
    }

    const response = await fetch(url, {
      method,
      redirect: 'manual',
      headers,
      body: bodyStr,
    });

    this.storeCookies(response);

    if (options.raw) {
      return { status: response.status, data: response };
    }

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data };
  }

  get(path: string) {
    return this.request('GET', path);
  }

  post(path: string, body: unknown = {}) {
    return this.request('POST', path, body);
  }

  patch(path: string, body: unknown = {}) {
    return this.request('PATCH', path, body);
  }

  del(path: string) {
    return this.request('DELETE', path);
  }
}

export const globalClient = new ApiClient();
