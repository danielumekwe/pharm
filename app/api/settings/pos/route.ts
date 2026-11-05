import { z } from "zod";

import { updatePosSettings } from "@/lib/erp/admin";
import { guarded } from "@/lib/session";

const schema = z.object({
  cashierMaxDiscountPct: z.number().min(0).max(100),
  approverMaxDiscountPct: z.number().min(0).max(100),
  salesTargets: z.record(z.string(), z.number().min(0)),
});

export async function PATCH(request: Request) {
  return guarded("settings.manage", async (actor) => updatePosSettings(actor, schema.parse(await request.json())));
}
