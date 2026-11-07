import { z } from "zod";

import { clearScheduledChange, setCancelAtPeriodEnd } from "@/lib/billing/service";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("clear-scheduled-change") }),
]);

/** Cancel at period end, undo that, or withdraw a scheduled downgrade. Pharmacy Super Admin only. */
export async function POST(request: Request) {
  return guarded("settings.manage", async (actor) => {
    if (actor.support) throw new DomainError("Support sessions cannot change the subscription.", 403);
    const input = schema.parse(await request.json());
    if (input.action === "clear-scheduled-change") return clearScheduledChange(actor);
    return setCancelAtPeriodEnd(actor, input.action === "cancel");
  }, 200, { allowLapsed: true });
}
