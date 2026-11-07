// Fixed-window rate limiting for sign-in endpoints, kept in process memory.
// Each server instance counts on its own, so on serverless hosting the effective limit is per instance;
// a shared store (database or KV) is planned with the Phase 8 hardening.
import { headers } from "next/headers";

type Window = { count: number; resetAt: number };
const registry = globalThis as typeof globalThis & { __pharmRateLimits?: Map<string, Window> };
const windows = (registry.__pharmRateLimits ??= new Map<string, Window>());

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`);
    this.name = "RateLimitError";
  }
}

/** Client address as reported by the hosting proxy (first X-Forwarded-For entry). */
export async function clientAddress() {
  try {
    const list = await headers();
    return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "unknown";
  } catch {
    return "unknown";
  }
}

/** Counts one attempt for key; throws RateLimitError once `limit` attempts happened within `windowMs`. */
export function hit(key: string, limit: number, windowMs: number) {
  if (process.env.RATE_LIMIT === "off") return;
  const now = Date.now();
  if (windows.size > 10_000) for (const [entry, window] of windows) if (window.resetAt <= now) windows.delete(entry);
  const window = windows.get(key);
  if (!window || window.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  window.count += 1;
  if (window.count > limit) throw new RateLimitError((window.resetAt - now) / 1000);
}

/** Throws if key already reached `limit` in its current window (does not count an attempt). */
export function check(key: string, limit: number) {
  if (process.env.RATE_LIMIT === "off") return;
  const window = windows.get(key);
  const now = Date.now();
  if (window && window.resetAt > now && window.count >= limit) throw new RateLimitError((window.resetAt - now) / 1000);
}

const FAILURES = 10;
const WINDOW = 15 * 60_000;
const failureKey = (identifier: string) => `signin:fail:${identifier.trim().toLowerCase()}`;

/**
 * Before checking a password: at most 60 sign-in requests per address, and 10 failed attempts per account
 * name, per 15 minutes. Successful sign-ins do not count against the account name.
 */
export async function limitSignIn(identifier: string) {
  hit(`signin:ip:${await clientAddress()}`, 60, WINDOW);
  check(failureKey(identifier), FAILURES);
}

export function recordSignInFailure(identifier: string) {
  hit(failureKey(identifier), Number.MAX_SAFE_INTEGER, WINDOW);
}
