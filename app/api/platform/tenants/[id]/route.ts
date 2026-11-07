import { z } from "zod";

import { changeTenantPlan, extendPaidPeriod, extendTrial, setTenantSubscriptionStatus } from "@/lib/platform/adjustments";
import { platformCan, platformGuarded } from "@/lib/platform/session";
import { decideClosure, updateTenantProfile } from "@/lib/platform/tenant-admin";
import { setTenantStatus, tenantDetail } from "@/lib/platform/tenants";
import { DomainError } from "@/lib/erp/services";

const reason = z.string().max(300).default("");
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string().max(300) }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("update-profile"), profile: z.unknown() }),
  z.object({ action: z.literal("extend-trial"), days: z.number().int(), reason }),
  z.object({ action: z.literal("extend-period"), days: z.number().int(), reason }),
  z.object({ action: z.literal("change-plan"), planId: z.string().min(1).max(40), billingCycle: z.enum(["MONTHLY", "ANNUAL"]), reason }),
  z.object({
    action: z.literal("subscription-status"),
    status: z.enum(["ACTIVE", "PAST_DUE", "GRACE", "SUSPENDED", "CANCELLED", "EXPIRED"]),
    currentPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    reason,
  }),
  z.object({ action: z.literal("closure"), requestId: z.string().min(1).max(80), decision: z.enum(["approve", "reject"]), note: z.string().max(600).default("") }),
]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("tenants.view", async () => tenantDetail(id));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("tenants.view", async (actor) => {
    const input = schema.parse(await request.json());
    const billing = ["extend-trial", "extend-period", "change-plan", "subscription-status"].includes(input.action);
    if (!platformCan(actor, billing ? "billing.manage" : "tenants.manage")) throw new DomainError(`Your platform role does not allow this (${billing ? "billing" : "pharmacy management"} permission needed).`, 403);
    if (input.action === "suspend") return setTenantStatus(actor, id, "SUSPENDED", input.reason);
    if (input.action === "reactivate") return setTenantStatus(actor, id, "ACTIVE", "");
    if (input.action === "update-profile") return updateTenantProfile(actor, id, input.profile);
    if (input.action === "closure") return decideClosure(actor, id, input.requestId, input.decision, input.note);
    if (input.action === "extend-trial") return extendTrial(actor, id, input.days, input.reason);
    if (input.action === "extend-period") return extendPaidPeriod(actor, id, input.days, input.reason);
    if (input.action === "change-plan") return changeTenantPlan(actor, id, input.planId, input.billingCycle, input.reason);
    return setTenantSubscriptionStatus(actor, id, input.status, input.currentPeriodEnd, input.reason);
  });
}
