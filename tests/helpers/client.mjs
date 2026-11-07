// Minimal HTTP client with a cookie jar that signs in through NextAuth like a browser.
export class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  store(response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /Max-Age=0/i.test(header)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, path, body, { raw = false } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      redirect: "manual",
      headers: { cookie: this.cookieHeader(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.store(response);
    if (raw) return response;
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data };
  }

  get(path) {
    return this.request("GET", path);
  }
  post(path, body) {
    return this.request("POST", path, body ?? {});
  }
  patch(path, body) {
    return this.request("PATCH", path, body ?? {});
  }
  delete(path) {
    return this.request("DELETE", path);
  }

  async csrf() {
    return (await this.get("/api/auth/csrf")).data.csrfToken;
  }

  /** Signs in with the credentials provider. Returns the NextAuth error message, or null on success. */
  /** tenantId: the pharmacy to sign in to (needed only for accounts that belong to several). */
  async login(identifier, outletId = "HQ", password = "Admin@123", tenantId = undefined) {
    const csrfToken = await this.csrf();
    const response = await fetch(`${this.baseUrl}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: this.cookieHeader(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, identifier, password, outletId, ...(tenantId ? { tenantId } : {}), json: "true" }),
    });
    this.store(response);
    const location = response.headers.get("location") ?? (await response.json().catch(() => ({}))).url ?? "";
    const error = new URL(location, this.baseUrl).searchParams.get("error");
    return error;
  }

  async session() {
    return (await this.get("/api/auth/session")).data;
  }

  /** Equivalent of next-auth's client-side `update(data)`. */
  async updateSession(data) {
    const csrfToken = await this.csrf();
    return (await this.request("POST", "/api/auth/session", { csrfToken, data })).data;
  }
}

export async function signedIn(baseUrl, identifier, outletId = "HQ", tenantId = undefined) {
  const client = new Client(baseUrl);
  const error = await client.login(identifier, outletId, "Admin@123", tenantId);
  if (error) throw new Error(`Login failed for ${identifier}: ${error}`);
  return client;
}
