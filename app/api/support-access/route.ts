import { z } from "zod";

import { decideSupportGrant, grantsForPharmacy } from "@/lib/platform/support";
import { guarded } from "@/lib/session";

const schema = z.object({ grantId: z.string().max(80), decision: z.enum(["APPROVED", "DENIED", "REVOKED"]) });

/** This pharmacy's Web365 support access requests. Super Admin only. */
export async function GET() {
  return guarded("settings.manage", async () => ({ grants: await grantsForPharmacy() }));
}

/** Approve, deny or revoke a support access request for this pharmacy. */
export async function PATCH(request: Request) {
  return guarded("settings.manage", async (actor) => {
    const input = schema.parse(await request.json());
    return decideSupportGrant(actor, input.grantId, input.decision);
  });
}
