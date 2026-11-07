import { z } from "zod";

import { changeTenantPlan, setTenantSubscriptionStatus } from "@/lib/platform/plans";
import { extendTrial, setTenantStatus, tenantDetail } from "@/lib/platform/tenants";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string().max(300) }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("extend-trial"), days: z.number().int() }),
  z.object({ action: z.literal("change-plan"), planId: z.string().min(1).max(40), billingCycle: z.enum(["MONTHLY", "ANNUAL"]) }),
  z.object({
    action: z.literal("subscription-status"),
    status: z.enum(["ACTIVE", "PAST_DUE", "GRACE", "SUSPENDED", "CANCELLED", "EXPIRED"]),
    currentPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("tenants.view", async () => tenantDetail(id));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("tenants.manage", async (actor) => {
    const input = schema.parse(await request.json());
    if (input.action === "suspend") return setTenantStatus(actor, id, "SUSPENDED", input.reason);
    if (input.action === "reactivate") return setTenantStatus(actor, id, "ACTIVE", "");
    if (input.action === "extend-trial") return extendTrial(actor, id, input.days);
    if (input.action === "change-plan") return changeTenantPlan(actor, id, input.planId, input.billingCycle);
    return setTenantSubscriptionStatus(actor, id, input.status, input.currentPeriodEnd);
  });
}
