import { z } from "zod";

import { requestBatchDestruction } from "@/lib/erp/inventory";
import { guarded } from "@/lib/session";

const schema = z.object({ action: z.literal("destroy"), note: z.string().max(200).default("") });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("stock.request", async (actor) => {
    const body = schema.parse(await request.json());
    return requestBatchDestruction(actor, id, body.note);
  });
}
