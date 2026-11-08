import { currentTenant } from "@/lib/db/database";
import { announcementsFor } from "@/lib/platform/content";
import { guarded } from "@/lib/session";

/** Live announcements from Web365 for this pharmacy that the signed-in person has not dismissed. */
export async function GET() {
  return guarded("dashboard.view", async (actor) => {
    const tenantId = currentTenant()?.id;
    return { announcements: tenantId ? await announcementsFor(tenantId, actor.id) : [] };
  }, 200, { allowLapsed: true });
}
