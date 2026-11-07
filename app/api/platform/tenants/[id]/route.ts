import { z } from "zod";

import { extendTrial, setTenantStatus, tenantDetail } from "@/lib/platform/tenants";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string().max(300) }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("extend-trial"), days: z.number().int() }),
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
    return extendTrial(actor, id, input.days);
  });
}
