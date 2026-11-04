import { z } from "zod";

import { setThresholdRule, updateAlertEmailSettings } from "@/lib/erp/alerts";
import { getStore } from "@/lib/erp/store";
import { guarded } from "@/lib/session";

export async function GET() {
  return guarded("alerts.configure", () => {
    const { lowStock, alertEmail } = getStore().settings;
    return { lowStock, alertEmail };
  });
}

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("email"),
    enabled: z.boolean().optional(),
    recipients: z.array(z.string().max(160)).max(25).optional(),
    notifyManagers: z.boolean().optional(),
    lowStockImmediate: z.boolean().optional(),
    criticalImmediate: z.boolean().optional(),
    dailySummary: z.boolean().optional(),
    maxRetries: z.number().int().optional(),
  }),
  z.object({ action: z.literal("rule"), scope: z.enum(["default", "outlet", "product"]), key: z.string().max(120), value: z.number().int().nullable() }),
]);

/** Low-stock threshold rules (default / outlet / product) and alert email settings. */
export async function PATCH(request: Request) {
  return guarded("alerts.configure", async (actor) => {
    const body = schema.parse(await request.json());
    if (body.action === "rule") return setThresholdRule(actor, body.scope, body.key, body.value);
    const { action: _action, ...input } = body;
    void _action;
    return updateAlertEmailSettings(actor, input);
  });
}
