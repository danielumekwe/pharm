import { z } from "zod";

import { platformGuarded } from "@/lib/platform/session";
import {
  blockRateLimitIp,
  rateLimitDashboard,
  removeRateLimitEntry,
  saveRateLimitIpRule,
  saveRateLimitPolicy,
  updateRateLimitConfig,
} from "@/lib/platform/rate-limits";
import { RATE_LIMIT_CATEGORY_IDS } from "@/lib/saas/rate-limit-categories";

const category = z.enum(RATE_LIMIT_CATEGORY_IDS);
const policySchema = z.object({
  id: z.string().max(100).optional(),
  category,
  label: z.string().trim().min(1).max(100),
  scopeType: z.enum(["global", "tenant", "user", "ip", "role", "endpoint"]),
  scopeValue: z.string().max(240).optional(),
  enabled: z.boolean(),
  requestsPerMinute: z.number().int().min(1).max(100_000),
  burst: z.number().int().min(0).max(100_000),
  windowSeconds: z.number().int().min(1).max(86_400),
  blockSeconds: z.number().int().min(0).max(86_400),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("config"), enabled: z.boolean() }),
  z.object({ action: z.literal("policy"), policy: policySchema }),
  z.object({
    action: z.literal("ip-rule"),
    address: z.string().trim().min(2).max(100),
    effect: z.enum(["allow", "block"]),
    reason: z.string().trim().max(200).default(""),
    expiresHours: z.number().int().min(1).max(720).optional(),
  }),
  z.object({
    action: z.literal("block"),
    ip: z.string().trim().min(2).max(45),
    reason: z.string().trim().min(5).max(200),
    expiresMinutes: z.number().int().min(1).max(1440),
  }),
  z.object({ action: z.literal("remove"), id: z.string().min(1).max(100), kind: z.enum(["policy", "rule", "block"]) }),
]);

function filterValue(value: string | null, max: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** Rate-limit configuration and monitoring. Platform Super Admin only. */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const eventType = search.get("eventType");
  return platformGuarded("rateLimits.manage", async () =>
    rateLimitDashboard({
      tenant: filterValue(search.get("tenant"), 100),
      ip: filterValue(search.get("ip"), 45),
      endpoint: filterValue(search.get("endpoint"), 240),
      from: filterValue(search.get("from"), 40),
      to: filterValue(search.get("to"), 40),
      eventType: eventType === "rate_limited" || eventType === "blocked_ip" || eventType === "automatic_block" ? eventType : undefined,
    }),
  );
}

export async function POST(request: Request) {
  return platformGuarded("rateLimits.manage", async (actor) => {
    const body = actionSchema.parse(await request.json());
    switch (body.action) {
      case "config":
        return updateRateLimitConfig(actor, body.enabled);
      case "policy":
        return saveRateLimitPolicy(actor, body.policy);
      case "ip-rule":
        return saveRateLimitIpRule(actor, body);
      case "block":
        return blockRateLimitIp(actor, body);
      case "remove":
        return removeRateLimitEntry(actor, body.id, body.kind);
    }
  });
}
