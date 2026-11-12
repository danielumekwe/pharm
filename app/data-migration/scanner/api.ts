"use client";

/** JSON request to the scanner API; returns the error message instead of throwing. */
export async function call<T>(url: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) return { ok: false, error: data.error ?? `Request failed (${response.status}).` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error. Check your connection and retry." };
  }
}
