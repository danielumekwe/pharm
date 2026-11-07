import { platformQuery } from "@/lib/db/database";
import { platformGuarded } from "@/lib/platform/session";

/** Email delivery log (never message bodies). ?status=FAILED|RETRYING|SENT|SKIPPED narrows it. */
export async function GET(request: Request) {
  return platformGuarded("settings.manage", async () => {
    const status = new URL(request.url).searchParams.get("status");
    const rows = await platformQuery<Array<Record<string, unknown>>>((query) =>
      query(
        `SELECT e.id, e.created_at, e.category, e.template, t.name AS pharmacy, e.recipient, e.subject, e.status, e.provider, e.attempts, e.next_attempt_at, e.last_error, e.sent_at,
                (e.body_ciphertext IS NOT NULL) AS retryable
         FROM email_deliveries e LEFT JOIN tenants t ON t.id = e.tenant_id
         WHERE ($1::text IS NULL OR e.status = $1) ORDER BY e.created_at DESC LIMIT 200`,
        [status],
      ),
    );
    return { deliveries: rows };
  });
}
