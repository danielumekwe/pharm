import { z } from "zod";

import { voidSale } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({ action: z.literal("void"), reason: z.string().min(3).max(200) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("sales.void", async (actor) => {
    const body = schema.parse(await request.json());
    return voidSale(actor, id, body.reason);
  });
}
