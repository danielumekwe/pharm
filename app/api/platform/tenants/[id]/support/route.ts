import { z } from "zod";

import { requestSupportAccess } from "@/lib/platform/support";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.object({ reason: z.string().max(500), minutes: z.number().int() });

/** Ask a pharmacy for time-limited, read-only support access. The pharmacy decides. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("support.request", async (actor) => {
    const input = schema.parse(await request.json());
    return requestSupportAccess(actor, id, input.reason, input.minutes);
  }, 201);
}
