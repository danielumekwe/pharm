import { z } from "zod";

import { resetTwoFactor } from "@/lib/platform/security";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.object({ reason: z.string().max(300) });

/** Removes someone's two-factor setup (lost phone). They must set it up again; their sessions end. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("staff.manage", async (actor) => resetTwoFactor(actor, id, schema.parse(await request.json()).reason));
}
