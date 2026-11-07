// Platform audit trail (platform_audit_events): append-only for the application role.
import { randomUUID } from "node:crypto";

import { platformQuery } from "@/lib/db/database";
import type { PlatformActor } from "@/lib/platform/session";
import { clientAddress } from "@/lib/saas/rate-limit";

export type PlatformAuditInput = {
  action: string;
  summary: string;
  targetType?: string;
  targetId?: string;
  tenantId?: string | null;
  severity?: "info" | "warning" | "critical";
};

type Actor = { id: string | null; name: string; type: "platform" | "pharmacy" | "system" };

export function platformActorRef(actor: PlatformActor): Actor {
  return { id: actor.id, name: `${actor.name} (Web365)`, type: "platform" };
}

export async function recordPlatformAudit(actor: Actor, event: PlatformAuditInput) {
  const ip = await clientAddress();
  await platformQuery((query) =>
    query(
      `INSERT INTO platform_audit_events (id, actor_id, actor_name, actor_type, action, target_type, target_id, tenant_id, summary, severity, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [`paud-${randomUUID()}`, actor.id, actor.name, actor.type, event.action, event.targetType ?? null, event.targetId ?? null, event.tenantId ?? null, event.summary, event.severity ?? "info", ip === "unknown" ? null : ip],
    ),
  );
}
