import { retryEmail } from "@/lib/notify/email";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformGuarded } from "@/lib/platform/session";

/** Sends a failed or waiting platform email again now. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("settings.manage", async (actor) => {
    const result = await retryEmail(id);
    await recordPlatformAudit(platformActorRef(actor), { action: "email.retry", targetType: "Email", targetId: id, summary: `Retried email ${id}: ${result.status.toLowerCase()}` });
    return result;
  });
}
