import { platformQuery } from "@/lib/db/database";
import { platformGuarded } from "@/lib/platform/session";

/** The platform audit trail, newest first. ?tenant=<id> narrows it to one pharmacy. */
export async function GET(request: Request) {
  return platformGuarded("audit.view", async () => {
    const tenant = new URL(request.url).searchParams.get("tenant");
    const rows = await platformQuery<Array<Record<string, unknown>>>((query) =>
      query(
        `SELECT a.at, a.actor_name, a.actor_type, a.action, a.target_type, a.target_id, a.tenant_id, t.name AS tenant_name, a.summary, a.severity, a.ip
         FROM platform_audit_events a LEFT JOIN tenants t ON t.id = a.tenant_id
         WHERE ($1::text IS NULL OR a.tenant_id = $1) ORDER BY a.at DESC LIMIT 500`,
        [tenant],
      ),
    );
    return { events: rows };
  });
}
