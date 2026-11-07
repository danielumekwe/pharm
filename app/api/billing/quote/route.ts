import { z } from "zod";

import { quote } from "@/lib/billing/service";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({ planId: z.string().min(1).max(40), billingCycle: z.enum(["MONTHLY", "ANNUAL"]) });

/** What a plan choice would cost now (with any credit for an upgrade), before going to payment. */
export async function GET(request: Request) {
  return guarded("settings.manage", async (actor) => {
    const url = new URL(request.url);
    const input = schema.parse({ planId: url.searchParams.get("planId"), billingCycle: url.searchParams.get("billingCycle") });
    if (!actor.tenantId) throw new DomainError("No pharmacy selected.", 401);
    return quote(actor.tenantId, input.planId, input.billingCycle);
  }, 200, { allowLapsed: true });
}
