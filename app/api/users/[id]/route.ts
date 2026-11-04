import { z } from "zod";

import { resendInvite, resetPassword, setUserStatus, updateUser } from "@/lib/erp/users";
import { guarded } from "@/lib/session";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    name: z.string().max(120).optional(),
    email: z.string().max(160).optional(),
    phone: z.string().max(30).optional(),
    role: z.string().optional(),
    outletIds: z.array(z.string()).max(20).optional(),
    primaryOutletId: z.string().nullable().optional(),
    grants: z.array(z.string()).max(40).optional(),
  }),
  z.object({ action: z.literal("status"), status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]), reason: z.string().max(200).default("") }),
  z.object({ action: z.literal("reset-password") }),
  z.object({ action: z.literal("resend-invite") }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("users.manage", async (actor) => {
    const body = schema.parse(await request.json());
    switch (body.action) {
      case "update": {
        const { action: _action, ...input } = body;
        void _action;
        return updateUser(actor, id, input);
      }
      case "status":
        return setUserStatus(actor, id, body.status, body.reason);
      case "reset-password":
        return resetPassword(actor, id);
      case "resend-invite":
        return resendInvite(actor, id);
    }
  });
}
