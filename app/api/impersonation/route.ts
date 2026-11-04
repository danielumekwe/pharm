import { z } from "zod";

import { startImpersonation, stopImpersonation } from "@/lib/erp/impersonation";
import { guarded } from "@/lib/session";

const schema = z.object({ targetUserId: z.string().min(1), password: z.string().min(1).max(128), reason: z.string().max(200) });

/** Start acting as another user. Requires the Super Administrator's password again (fresh authentication). */
export async function POST(request: Request) {
  return guarded("users.manage", async (actor) => startImpersonation(actor, schema.parse(await request.json())), 201);
}

/** End the current impersonation session and return to the administrator account. */
export async function DELETE() {
  return guarded("dashboard.view", (actor) => stopImpersonation(actor));
}
