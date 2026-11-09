import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { getToken, decode } from "next-auth/jwt";
import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { AUTH_SECRET } from "@/lib/auth-secret";
import { platformQuery } from "@/lib/db/database";
import { RATE_LIMIT_CATEGORY_IDS } from "@/lib/saas/rate-limit-categories";

export { RATE_LIMIT_CATEGORY_IDS } from "@/lib/saas/rate-limit-categories";

export class RateLimitError extends Error {
  public resetAt: number;

  constructor(public retryAfterSeconds: number, public limit = 0) {
    super("Too many requests. Please try again shortly.");
    this.name = "RateLimitError";
    this.resetAt = Date.now() + Math.ceil(retryAfterSeconds * 1000);
  }
}

export function rateLimitErrorResponse(error: RateLimitError) {
  return NextResponse.json(
    { error: error.message },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterSeconds))),
        "RateLimit-Limit": String(error.limit),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(Math.ceil(error.resetAt / 1000)),
      },
    },
  );
}

type Policy = {
  id: string;
  category: string;
  label: string;
  scope_type: "global" | "tenant" | "user" | "ip" | "role" | "endpoint";
  scope_value: string;
  enabled: boolean;
  requests_per_minute: number;
  burst: number;
  window_seconds: number;
  block_seconds: number;
};

type Check = { key: string; limit: number; windowMs: number; label: string; blockSeconds: number };
type CheckResult =
  | { enabled: false }
  | { enabled: true; response: NextResponse }
  | { enabled: true; response: null; limit: number; remaining: number; resetAt: number };

const PLATFORM_COOKIE = "pharm_platform";
const PLATFORM_SECRET = `${AUTH_SECRET}:web365-platform`;
const RATE_LIMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local count = tonumber(ARGV[2])
local bestRemaining = nil
local bestLimit = nil
local bestReset = nil
for i = 1, count do
  local offset = 3 + ((i - 1) * 3)
  local limit = tonumber(ARGV[offset])
  local window = tonumber(ARGV[offset + 1])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)
  local used = redis.call('ZCARD', KEYS[i])
  if used >= limit then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    local reset = now + window
    if oldest[2] then reset = tonumber(oldest[2]) + window end
    return {0, i, limit, 0, reset}
  end
  local remaining = limit - used - 1
  if bestRemaining == nil or remaining < bestRemaining then
    bestRemaining = remaining
    bestLimit = limit
    bestReset = now + window
  end
end
for i = 1, count do
  local offset = 3 + ((i - 1) * 3)
  redis.call('ZADD', KEYS[i], now, ARGV[offset + 2])
  redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[offset + 1]))
end
return {1, 0, bestLimit or 0, bestRemaining or 0, bestReset or now}
`;

function isWorkersRuntime() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function validAddress(value: string | null | undefined) {
  const address = value?.trim() ?? "";
  return isIP(address) ? address : null;
}

/** Only accept headers written by a known hosting proxy or explicitly trusted ingress. */
export function addressFromHeaders(requestHeaders: Headers): string {
  if (isWorkersRuntime()) return validAddress(requestHeaders.get("cf-connecting-ip")) ?? "unknown";
  if (process.env.VERCEL === "1") return validAddress(requestHeaders.get("x-real-ip")) ?? "unknown";
  const configured = process.env.RATE_LIMIT_TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  if (configured && /^[a-z0-9-]+$/.test(configured)) return validAddress(requestHeaders.get(configured)) ?? "unknown";
  return "unknown";
}

export async function clientAddress() {
  try {
    return addressFromHeaders(await headers());
  } catch {
    return "unknown";
  }
}

export function redisRateLimitConfigured() {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!endpoint || !token) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function redisEndpoint() {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!endpoint || !token || !redisRateLimitConfigured()) throw new Error("Distributed rate-limit storage is not configured.");
  return { endpoint, token };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function redisCheck(checks: Check[], now: number) {
  const { endpoint, token } = redisEndpoint();
  const keys = checks.map((check) => check.key);
  const args = checks.flatMap((check) => [String(check.limit), String(check.windowMs), randomUUID()]);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", RATE_LIMIT_SCRIPT, String(keys.length), ...keys, String(now), String(keys.length), ...args]),
    signal: AbortSignal.timeout(2_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Redis REST request failed (${response.status}).`);
  const result = await response.json() as { result?: unknown; error?: string };
  if (result.error || !Array.isArray(result.result) || result.result.length < 5) throw new Error("Redis REST returned an invalid rate-limit response.");
  const values = result.result.map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Redis REST returned an invalid rate-limit response.");
  return { allowed: values[0] === 1, failedIndex: values[1] - 1, limit: values[2], remaining: values[3], resetAt: values[4] };
}

function categoryFor(path: string, method: string) {
  if (/\/api\/platform\/login\/verify$/.test(path) || /\/api\/platform\/me\/two-factor/.test(path)) return "otp_verification";
  if (/\/api\/(auth\/pharmacies|auth\/callback\/credentials|mobile\/login|platform\/login)$/.test(path)) return "login";
  if (/\/api\/(register|auth\/join|invite)$/.test(path)) return "registration";
  if (/\/api\/auth\/password\/(forgot|reset)$/.test(path)) return "password_reset";
  if (/\/api\/(auth\/verify-email|account\/verify-email)$/.test(path)) return "email_verification";
  if (/\/api\/(contact|contacts|demo)(\/|$)/.test(path)) return "public_forms";
  if (/\/api\/(branding\/logo|settings\/logo|regulatory\/documents)(\/|$)/.test(path)) return "file_uploads";
  if (/\/api\/(reports|inventory-reports|sales-overview)(\/|$)/.test(path)) return "report_generation";
  if (/\/api\/transfers(\/|$)/.test(path)) return "stock_transfers";
  if (/\/api\/(barcodes|products\/[^/]+\/barcodes)$/.test(path)) return "barcode_lookup";
  if (/\/api\/(products|catalog|pos\/catalog)(\/|$)/.test(path) && method === "GET") return "product_search";
  if (/\/api\/(sales|pos\/held)(\/|$)/.test(path) && method !== "GET") return "pos_transactions";
  if (/\/api\/(inventory|batches|stock-ledger|stock-levels|stock-movements)(\/|$)/.test(path)) return "inventory_operations";
  return "api_general";
}

async function identityFor(request: NextRequest) {
  let userId: string | null = null;
  let tenantId: string | null = null;
  let role: string | null = null;
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const bearer = await decode({ token: authorization.slice(7).trim(), secret: AUTH_SECRET }).catch(() => null);
    if (bearer?.mobile === true && typeof bearer.id === "string" && typeof bearer.tenantId === "string") {
      userId = bearer.id;
      tenantId = bearer.tenantId;
      const [row] = await platformQuery<Array<{ role: string }>>((query) =>
        query(
          `SELECT m.role FROM tenant_memberships m
           JOIN tenants t ON t.id = m.tenant_id
           WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.status = 'ACTIVE' AND t.status = 'ACTIVE'`,
          [tenantId, userId],
        ),
      );
      role = row?.role ?? null;
    }
    return { userId, tenantId, role };
  }

  const platformToken = request.cookies.get(PLATFORM_COOKIE)?.value;
  if (platformToken) {
    const payload = await decode({ token: platformToken, secret: PLATFORM_SECRET }).catch(() => null);
    if (payload?.platform === true && typeof payload.pid === "string") {
      userId = payload.pid;
      const [row] = await platformQuery<Array<{ role: string }>>((query) =>
        query(`SELECT role FROM platform_users WHERE id = $1 AND status = 'ACTIVE'`, [userId]),
      );
      role = row?.role ?? null;
    }
  } else {
    const token = await getToken({ req: request, secret: AUTH_SECRET }).catch(() => null);
    if (token) {
      const identity = typeof token.id === "string" ? token.id : typeof token.sub === "string" ? token.sub : null;
      const tenant = typeof token.tenantId === "string" ? token.tenantId : null;
      if (identity && tenant && tenant !== "_platform") {
        userId = identity;
        tenantId = tenant;
        const [row] = await platformQuery<Array<{ role: string }>>((query) =>
          query(`SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [tenant, identity]),
        );
        role = row?.role ?? null;
      }
    }
  }
  return { userId, tenantId, role };
}

async function recordEvent(event: {
  tenantId: string | null;
  userId: string | null;
  ip: string;
  endpoint: string;
  method: string;
  policy: string;
  limit: number;
  action: "rate_limited" | "temporary_blocked" | "blocked_ip";
  eventType: "rate_limited" | "blocked_ip" | "automatic_block";
  blockExpiresAt?: Date | null;
}) {
  await platformQuery((query) =>
    query(
      `INSERT INTO platform_rate_limit_events
       (id, tenant_id, user_id, ip, endpoint, method, policy, limit_exceeded, action, event_type, block_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        `rlev-${randomUUID()}`, event.tenantId, event.userId, event.ip, event.endpoint, event.method,
        event.policy, event.limit, event.action, event.eventType, event.blockExpiresAt ?? null,
      ],
    ),
    { independent: true },
  );
}

function tooManyRequests(limit: number, resetAt: number, now: number) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "RateLimit-Limit": String(limit),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
      },
    },
  );
}

/** Enforces the same Redis-backed checks before every App Router API handler. */
export async function enforceApiRateLimit(request: NextRequest): Promise<CheckResult> {
  if (process.env.RATE_LIMITING_FORCE_OFF === "1") return { enabled: false };

  const path = request.nextUrl.pathname;
  const [config] = await platformQuery<Array<{ enabled: boolean }>>((query) =>
    query(`SELECT enabled FROM platform_rate_limit_config WHERE id = 'global'`),
  );
  if (!config?.enabled) return { enabled: false };
  if (!redisRateLimitConfigured()) {
    return {
      enabled: true,
      response: NextResponse.json({ error: "API protection is temporarily unavailable." }, { status: 503 }),
    };
  }

  const now = Date.now();
  const ip = addressFromHeaders(request.headers);
  const identity = await identityFor(request);
  const [policies, rules, blocks] = await Promise.all([
    platformQuery<Policy[]>((query) =>
      query(`SELECT id, category, label, scope_type, scope_value, enabled, requests_per_minute, burst, window_seconds, block_seconds FROM platform_rate_limit_policies`),
    ),
    platformQuery<Array<{ address: string; effect: "allow" | "block" }>>((query) =>
      query(`SELECT address, effect FROM platform_rate_limit_ip_rules WHERE expires_at IS NULL OR expires_at > now()`),
    ),
    ip === "unknown"
      ? Promise.resolve([] as Array<{ id: string; reason: string; expires_at: Date }>)
      : platformQuery<Array<{ id: string; reason: string; expires_at: Date }>>((query) =>
        query(`SELECT id, reason, expires_at FROM platform_rate_limit_blocks WHERE ip = $1 AND expires_at > now()`, [ip]),
      ),
  ]);
  const endpoint = path.slice(0, 240);
  const method = request.method.toUpperCase().slice(0, 12);
  const { ipAllowed } = await import("@/lib/platform/security");
  const allowlistedAddresses = rules.filter((rule) => rule.effect === "allow").map((rule) => rule.address);
  const allowedAddress = ip !== "unknown" && allowlistedAddresses.length > 0 && ipAllowed(ip, allowlistedAddresses);

  if (blocks.length || (ip !== "unknown" && rules.some((rule) => rule.effect === "block" && ipAllowed(ip, [rule.address])))) {
    const expiresAt = blocks[0]?.expires_at ? new Date(blocks[0].expires_at) : null;
    await recordEvent({
      tenantId: identity.tenantId, userId: identity.userId, ip, endpoint, method,
      policy: "ip_blocklist", limit: 0, action: "blocked_ip", eventType: "blocked_ip", blockExpiresAt: expiresAt,
    });
    const resetAt = expiresAt?.getTime() ?? now + 60_000;
    return { enabled: true, response: tooManyRequests(0, resetAt, now) };
  }

  const category = categoryFor(path, method);
  const applicableCategories = category === "api_general" ? ["api_general"] : ["api_general", category];
  const checks: Check[] = [];
  for (const categoryName of applicableCategories) {
    if (!RATE_LIMIT_CATEGORY_IDS.includes(categoryName as typeof RATE_LIMIT_CATEGORY_IDS[number])) continue;
    const base = policies.find((policy) => policy.category === categoryName && policy.scope_type === "global" && policy.scope_value === "");
    if (!base) continue;
    const ipBase = policies.find((policy) => policy.category === categoryName && policy.scope_type === "ip" && policy.scope_value === "");

    const dimensions: Array<{ type: Policy["scope_type"] | "ip"; subject: string | null }> = [
      { type: "global", subject: "platform" },
      { type: "tenant", subject: identity.tenantId },
      { type: "user", subject: identity.userId },
      { type: "ip", subject: allowedAddress ? null : ip },
      { type: "role", subject: identity.role },
      { type: "endpoint", subject: path },
    ];
    for (const dimension of dimensions) {
      if (!dimension.subject) continue;
      const override = dimension.type === "global"
        ? undefined
        : policies.find((policy) => policy.category === categoryName && policy.scope_type === dimension.type && policy.scope_value === dimension.subject);
      const policy = override ?? (dimension.type === "ip" ? ipBase ?? base : base);
      if (!policy.enabled) continue;
      const subject = dimension.type === "role" || dimension.type === "endpoint"
        ? `${identity.tenantId ?? "platform"}:${dimension.subject}`
        : dimension.subject;
      checks.push({
        key: `pharm:ratelimit:${categoryName}:${dimension.type}:${digest(subject)}`,
        limit: policy.requests_per_minute + policy.burst,
        windowMs: policy.window_seconds * 1000,
        label: `${policy.label} (${dimension.type})`,
        blockSeconds: policy.block_seconds,
      });
    }
  }

  if (!checks.length) return { enabled: false };

  try {
    const result = await redisCheck(checks, now);
    if (!result.allowed) {
      const triggered = checks[result.failedIndex] ?? checks[0];
      let action: "rate_limited" | "temporary_blocked" = "rate_limited";
      let blockExpiresAt: Date | null = null;
      if (triggered.blockSeconds > 0 && ip !== "unknown" && !allowedAddress) {
        const expires = new Date(now + triggered.blockSeconds * 1000);
        const [block] = await platformQuery<Array<{ expires_at: Date }>>((query) =>
          query(
            `INSERT INTO platform_rate_limit_blocks (id, ip, reason, expires_at, created_by)
             VALUES ($1, $2, $3, $4, 'automatic')
             ON CONFLICT (ip) DO UPDATE SET id = EXCLUDED.id, reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, created_at = now()
             WHERE platform_rate_limit_blocks.expires_at <= now()
             RETURNING expires_at`,
            [`rlb-${randomUUID()}`, ip, `Automatic temporary block: ${triggered.label}`, expires],
          ),
        );
        if (block?.expires_at) {
          action = "temporary_blocked";
          blockExpiresAt = new Date(block.expires_at);
        }
      }
      await recordEvent({
        tenantId: identity.tenantId, userId: identity.userId, ip, endpoint, method,
        policy: triggered.label, limit: triggered.limit, action,
        eventType: action === "temporary_blocked" ? "automatic_block" : "rate_limited", blockExpiresAt,
      });
      return { enabled: true, response: tooManyRequests(result.limit, result.resetAt, now) };
    }
    return {
      enabled: true,
      response: null,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.resetAt,
    };
  } catch (error) {
    console.error("[rate-limit] distributed enforcement failed", error instanceof Error ? error.name : "unknown");
    return {
      enabled: true,
      response: NextResponse.json({ error: "API protection is temporarily unavailable." }, { status: 503 }),
    };
  }
}

/** Shared login protection remains account-based and backed by the persisted sign-in log. */
export async function limitSignIn(identifier: string) {
  const { pharmacyLockedOut } = await import("@/lib/platform/security");
  if (await pharmacyLockedOut(identifier)) throw new RateLimitError(15 * 60, 10);
}
