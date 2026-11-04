import { z } from "zod";

import { markNotificationsRead, notificationsFor, scanAlerts } from "@/lib/erp/alerts";
import { guarded } from "@/lib/session";

export async function GET() {
  return guarded("dashboard.view", (actor) => {
    scanAlerts();
    return notificationsFor(actor);
  });
}

const schema = z.object({ ids: z.union([z.literal("all"), z.array(z.string()).max(100)]) });

export async function PATCH(request: Request) {
  return guarded("dashboard.view", async (actor) => markNotificationsRead(actor, schema.parse(await request.json()).ids));
}
