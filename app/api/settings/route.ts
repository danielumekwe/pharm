import { z } from "zod";

import { resetSettings, updateImpersonationSettings, updateSettings } from "@/lib/erp/admin";
import { guarded } from "@/lib/session";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    businessName: z.string().max(80).optional(),
    vatRate: z.number().optional(),
    minShelfLifeDays: z.number().int().optional(),
    expiryIntervals: z.array(z.number()).max(8).optional(),
    criticalShortagePct: z.number().optional(),
    dailySummaryHour: z.number().int().optional(),
    inviteValidityHours: z.number().int().optional(),
    supplierPaymentApprovalThreshold: z.number().optional(),
    passwordMinLength: z.number().int().optional(),
  }),
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("impersonation"), enabled: z.boolean(), onDisable: z.enum(["terminate", "expire"]), maxMinutes: z.number().int() }),
]);

export async function POST(request: Request) {
  return guarded("settings.manage", async (actor) => {
    const body = schema.parse(await request.json());
    if (body.action === "reset") return resetSettings(actor);
    if (body.action === "impersonation") return updateImpersonationSettings(actor, { enabled: body.enabled, onDisable: body.onDisable, maxMinutes: body.maxMinutes });
    const { action: _action, ...input } = body;
    void _action;
    return updateSettings(actor, input);
  });
}
