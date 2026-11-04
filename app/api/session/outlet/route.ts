import { z } from "zod";

import { users } from "@/lib/data";
import { canSwitchTo, HEAD_OFFICE } from "@/lib/erp/access";
import { DomainError, outletName } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({ outletId: z.string().max(60) });

/** Pre-checks an outlet switch so the UI can explain refusals. The JWT callback re-validates the switch. */
export async function POST(request: Request) {
  return guarded("dashboard.view", async (actor) => {
    const { outletId } = schema.parse(await request.json());
    const record = users.find((user) => user.id === actor.id);
    const target = outletId === HEAD_OFFICE ? null : outletId;
    if (!record || !canSwitchTo(record, target)) {
      throw new DomainError(target ? `You are not assigned to ${outletName(target)}.` : "Only central roles can view all outlets.", 403);
    }
    return { outletId: target, label: outletName(target) };
  });
}
