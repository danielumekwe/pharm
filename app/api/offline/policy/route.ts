import { z } from "zod";

import { offlinePolicy, updateOfflinePolicy } from "@/lib/erp/offline-devices";
import { guarded } from "@/lib/session";

const schema = z.object({ enabled: z.boolean().optional(), sessionHours: z.number().int().optional(), stockPolicy: z.enum(["cached-limit", "allow-negative"]).optional() });

export async function GET() {
  return guarded("dashboard.view", () => offlinePolicy());
}

export async function PATCH(request: Request) {
  return guarded("settings.manage", async (actor) => updateOfflinePolicy(actor, schema.parse(await request.json())));
}
