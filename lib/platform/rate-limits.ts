import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { redisRateLimitConfigured } from "@/lib/saas/rate-limit";
import { RATE_LIMIT_CATEGORY_IDS } from "@/lib/saas/rate-limit-categories";

type Policy = {
  id: string;
  category: string;
  label: string;
  scope_type: string;
  scope_value: string;
  enabled: boolean;
  requests_per_minute: number;
  burst: number;
  window_seconds: number;
  block_seconds: number;
  updated_at: Date;
};

export type RateLimitFilters = {
  tenant?: string;
  ip?: string;
  endpoint?: string;
  from?: string;
  to?: string;
  eventType?: string;
};

function validIpOrCidr(value: string) {
  const [address, bits, extra] = value.split("/");
  const family = isIP(address);
  if (!family || extra !== undefined) return false;
  if (bits === undefined) return true;
  if (!/^\d+$/.test(bits)) return false;
  const prefix = Number(bits);
  return prefix >= 0 && prefix <= (family === 4 ? 32 : 128);
}

function audit(actor: PlatformActor, action: string, summary: string, targetId?: string) {
  return recordPlatformAudit(platformActorRef(actor), {
    action: `rate-limits.${action}`,
    targetType: "RateLimit",
    targetId,
    summary,
  });
}

export async function rateLimitDashboard(filters: RateLimitFilters = {}) {
  const args: unknown[] = [];
  const clauses: string[] = [];
  const add = (value: unknown) => {
    args.push(value);
    return `$${args.length}`;
  };
  if (filters.tenant) clauses.push(`tenant_id = ${add(filters.tenant)}`);
  if (filters.ip) clauses.push(`ip = ${add(filters.ip)}`);
  if (filters.endpoint) clauses.push(`endpoint ILIKE ${add(`%${filters.endpoint}%`)}`);
  for (const [field, operator] of [["from", ">="], ["to", "<"]] as const) {
    const value = filters[field];
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new DomainError("Date filters must be valid timestamps.", 400);
    clauses.push(`at ${operator} ${add(date.toISOString())}::timestamptz`);
  }
  if (filters.eventType) clauses.push(`event_type = ${add(filters.eventType)}`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [config, policies, rules, blocks, events, summary, tenantUsage] = await platformQuery(async (query) => {
    const [rateConfig] = await query<{ enabled: boolean }>(`SELECT enabled FROM platform_rate_limit_config WHERE id = 'global'`);
    const ratePolicies = await query<Policy>(`SELECT id, category, label, scope_type, scope_value, enabled, requests_per_minute, burst, window_seconds, block_seconds, updated_at FROM platform_rate_limit_policies ORDER BY scope_type, category, scope_value`);
    const ipRules = await query<{ id: string; address: string; effect: "allow" | "block"; reason: string; expires_at: Date | null; created_at: Date }>(
      `SELECT id, address, effect, reason, expires_at, created_at FROM platform_rate_limit_ip_rules ORDER BY effect, address`,
    );
    const activeBlocks = await query<{ id: string; ip: string; reason: string; expires_at: Date; created_at: Date }>(
      `SELECT id, ip, reason, expires_at, created_at FROM platform_rate_limit_blocks WHERE expires_at > now() ORDER BY expires_at`,
    );
    const rateEvents = await query<{
      id: string; at: Date; tenant_id: string | null; user_id: string | null; ip: string; endpoint: string;
      method: string; policy: string; limit_exceeded: number; action: string; event_type: string; block_expires_at: Date | null;
    }>(
      `SELECT id, at, tenant_id, user_id, ip, endpoint, method, policy, limit_exceeded, action, event_type, block_expires_at
       FROM platform_rate_limit_events ${where} ORDER BY at DESC LIMIT 100`,
      args,
    );
    const [counts] = await query<{ violations: string; blocked: string; last_hour: string }>(
      `SELECT count(*) FILTER (WHERE at > now() - interval '24 hours') AS violations,
              count(*) FILTER (WHERE event_type IN ('blocked_ip', 'automatic_block') AND at > now() - interval '24 hours') AS blocked,
              count(*) FILTER (WHERE at > now() - interval '1 hour') AS last_hour
       FROM platform_rate_limit_events`,
    );
    const usage = await query<{ tenant_id: string; violations: string }>(
      `SELECT tenant_id, count(*) AS violations FROM platform_rate_limit_events
       WHERE tenant_id IS NOT NULL AND at > now() - interval '24 hours'
       GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 20`,
    );
    return [rateConfig, ratePolicies, ipRules, activeBlocks, rateEvents, counts, usage] as const;
  });

  return {
    config: { enabled: Boolean(config?.enabled), redisConfigured: redisRateLimitConfigured() },
    policies: policies.map((policy) => ({ ...policy, updated_at: new Date(policy.updated_at).toISOString() })),
    ipRules: rules.map((rule) => ({
      ...rule,
      created_at: new Date(rule.created_at).toISOString(),
      expires_at: rule.expires_at ? new Date(rule.expires_at).toISOString() : null,
    })),
    blocks: blocks.map((block) => ({ ...block, created_at: new Date(block.created_at).toISOString(), expires_at: new Date(block.expires_at).toISOString() })),
    events: events.map((event) => ({
      ...event,
      at: new Date(event.at).toISOString(),
      block_expires_at: event.block_expires_at ? new Date(event.block_expires_at).toISOString() : null,
    })),
    summary: {
      violations24h: Number(summary?.violations ?? 0),
      blocked24h: Number(summary?.blocked ?? 0),
      violations1h: Number(summary?.last_hour ?? 0),
      enabledPolicies: policies.filter((policy) => policy.enabled).length,
    },
    tenantUsage: tenantUsage.map((entry) => ({ tenantId: entry.tenant_id, violations: Number(entry.violations) })),
  };
}

export async function updateRateLimitConfig(actor: PlatformActor, enabled: boolean) {
  if (enabled && !redisRateLimitConfigured()) {
    throw new DomainError("Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN before enabling distributed rate limiting.", 503);
  }
  await platformQuery((query) =>
    query(`UPDATE platform_rate_limit_config SET enabled = $1, updated_at = now(), updated_by = $2 WHERE id = 'global'`, [enabled, actor.id]),
  );
  await audit(actor, "config-updated", `Global rate limiting ${enabled ? "enabled" : "disabled"}.`);
  return { enabled, redisConfigured: redisRateLimitConfigured() };
}

export type RateLimitPolicyInput = {
  id?: string;
  category: string;
  label: string;
  scopeType: "global" | "tenant" | "user" | "ip" | "role" | "endpoint";
  scopeValue?: string;
  enabled: boolean;
  requestsPerMinute: number;
  burst: number;
  windowSeconds: number;
  blockSeconds: number;
};

export async function saveRateLimitPolicy(actor: PlatformActor, input: RateLimitPolicyInput) {
  if (!RATE_LIMIT_CATEGORY_IDS.includes(input.category as typeof RATE_LIMIT_CATEGORY_IDS[number])) throw new DomainError("Choose a supported policy category.", 400);
  const value = input.scopeType === "global" || (input.scopeType === "ip" && input.id && !input.scopeValue) ? "" : input.scopeValue?.trim() ?? "";
  if ((input.scopeType === "global" || (input.scopeType === "ip" && !value)) && !input.id) {
    throw new DomainError("Base policies are created by the migration and cannot be duplicated.", 400);
  }
  if (input.scopeType !== "global" && !value && input.scopeType !== "ip") throw new DomainError("Enter a scope value.", 400);
  if (input.scopeType === "ip" && value && isIP(value) === 0) throw new DomainError("IP overrides require one exact IPv4 or IPv6 address.", 400);
  if (input.scopeType === "endpoint" && (!value.startsWith("/api/") || value.includes("?") || value.includes("#"))) {
    throw new DomainError("Endpoint overrides must be an exact API path beginning with /api/.", 400);
  }
  if (input.scopeType === "role" && !/^[A-Z_]{1,60}$/.test(value)) throw new DomainError("Enter a valid role name.", 400);
  if (input.scopeType === "tenant") {
    const [tenant] = await platformQuery<Array<{ id: string }>>((query) => query(`SELECT id FROM tenants WHERE id = $1`, [value]));
    if (!tenant) throw new DomainError("That tenant does not exist.", 404);
  }
  if (input.scopeType === "user" && !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new DomainError("Enter a valid user ID.", 400);

  const id = input.id ?? `rlp-${randomUUID()}`;
  const [saved] = await platformQuery<Policy[]>((query) =>
    input.id
      ? query(
        `UPDATE platform_rate_limit_policies
         SET label = $2, enabled = $3, requests_per_minute = $4, burst = $5, window_seconds = $6,
             block_seconds = $7, updated_at = now(), updated_by = $8
         WHERE id = $1 RETURNING id, category, label, scope_type, scope_value, enabled, requests_per_minute, burst, window_seconds, block_seconds, updated_at`,
        [id, input.label.trim(), input.enabled, input.requestsPerMinute, input.burst, input.windowSeconds, input.blockSeconds, actor.id],
      )
      : query(
        `INSERT INTO platform_rate_limit_policies
         (id, category, label, scope_type, scope_value, enabled, requests_per_minute, burst, window_seconds, block_seconds, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (category, scope_type, scope_value)
         DO UPDATE SET label = EXCLUDED.label, enabled = EXCLUDED.enabled, requests_per_minute = EXCLUDED.requests_per_minute,
           burst = EXCLUDED.burst, window_seconds = EXCLUDED.window_seconds, block_seconds = EXCLUDED.block_seconds,
           updated_at = now(), updated_by = EXCLUDED.updated_by
         RETURNING id, category, label, scope_type, scope_value, enabled, requests_per_minute, burst, window_seconds, block_seconds, updated_at`,
        [id, input.category, input.label.trim(), input.scopeType, value, input.enabled, input.requestsPerMinute, input.burst, input.windowSeconds, input.blockSeconds, actor.id],
      ),
  );
  if (!saved) throw new DomainError("That policy could not be found.", 404);
  await audit(actor, "policy-saved", `Updated ${saved.label} (${saved.scope_type}${saved.scope_value ? `: ${saved.scope_value}` : ""}).`, saved.id);
  return saved;
}

export async function saveRateLimitIpRule(
  actor: PlatformActor,
  input: { address: string; effect: "allow" | "block"; reason: string; expiresHours?: number },
) {
  const address = input.address.trim();
  if (!validIpOrCidr(address)) throw new DomainError("Enter a valid IPv4/IPv6 address or CIDR range.", 400);
  if (input.effect === "block" && (!input.expiresHours || input.expiresHours > 720)) {
    throw new DomainError("Blocklist entries must expire within 30 days.", 400);
  }
  const expiry = input.expiresHours ? new Date(Date.now() + input.expiresHours * 60 * 60_000) : null;
  const [rule] = await platformQuery<Array<{ id: string }>>((query) =>
    query(
      `INSERT INTO platform_rate_limit_ip_rules (id, address, effect, reason, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (address, effect) DO UPDATE SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at
       RETURNING id`,
      [`rlir-${randomUUID()}`, address, input.effect, input.reason.trim().slice(0, 200), expiry, actor.id],
    ),
  );
  await audit(actor, "ip-rule-saved", `${input.effect === "allow" ? "Allowlisted" : "Blocklisted"} ${address}.`, rule?.id);
  return { id: rule?.id, address, effect: input.effect, expiresAt: expiry?.toISOString() ?? null };
}

export async function blockRateLimitIp(actor: PlatformActor, input: { ip: string; reason: string; expiresMinutes: number }) {
  if (isIP(input.ip.trim()) === 0) throw new DomainError("Enter a valid IP address.", 400);
  const expiry = new Date(Date.now() + input.expiresMinutes * 60_000);
  const ip = input.ip.trim();
  const [block] = await platformQuery<Array<{ id: string }>>((query) =>
    query(
      `INSERT INTO platform_rate_limit_blocks (id, ip, reason, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ip) DO UPDATE SET id = EXCLUDED.id, reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, created_at = now(), created_by = EXCLUDED.created_by
       RETURNING id`,
      [`rlb-${randomUUID()}`, ip, input.reason.trim().slice(0, 200), expiry, actor.id],
    ),
  );
  await audit(actor, "ip-blocked", `Temporarily blocked ${ip} until ${expiry.toISOString()}.`, block?.id);
  return { id: block?.id, ip, expiresAt: expiry.toISOString() };
}

export async function removeRateLimitEntry(actor: PlatformActor, id: string, kind: "policy" | "rule" | "block") {
  const table = kind === "policy" ? "platform_rate_limit_policies" : kind === "rule" ? "platform_rate_limit_ip_rules" : "platform_rate_limit_blocks";
  const filter = kind === "policy" ? `id = $1 AND scope_type <> 'global' AND NOT (scope_type = 'ip' AND scope_value = '')` : `id = $1`;
  const [removed] = await platformQuery<Array<{ id: string }>>((query) =>
    query(`DELETE FROM ${table} WHERE ${filter} RETURNING id`, [id]),
  );
  if (!removed) throw new DomainError("That rate-limit entry could not be found.", 404);
  await audit(actor, `${kind}-removed`, `Removed ${kind} ${id}.`, id);
  return { ok: true };
}
