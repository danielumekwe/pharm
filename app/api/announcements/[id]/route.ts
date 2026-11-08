import { currentTenant } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { dismissAnnouncement } from "@/lib/platform/content";
import { guarded } from "@/lib/session";

/** Dismisses an announcement for the signed-in person. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("dashboard.view", async (actor) => {
    const tenantId = currentTenant()?.id;
    if (!tenantId) throw new DomainError("No pharmacy selected.", 401);
    if (actor.support) return { ok: true }; // support sessions leave no trace on the pharmacy's own state
    return dismissAnnouncement(tenantId, actor.id, id);
  }, 200, { allowLapsed: true });
}
