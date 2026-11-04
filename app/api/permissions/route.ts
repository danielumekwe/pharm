import { z } from "zod";

import { applyPermissionChanges, resetRolePermissions } from "@/lib/erp/admin";
import { guarded } from "@/lib/session";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply"),
    reason: z.string().max(300),
    changes: z.array(z.object({ role: z.string(), permission: z.string(), granted: z.boolean() })).min(1).max(200),
  }),
  z.object({ action: z.literal("reset"), role: z.string(), reason: z.string().max(300) }),
]);

export async function POST(request: Request) {
  return guarded("permissions.manage", async (actor) => {
    const body = schema.parse(await request.json());
    return body.action === "apply" ? applyPermissionChanges(actor, body.changes, body.reason) : resetRolePermissions(actor, body.role, body.reason);
  });
}
