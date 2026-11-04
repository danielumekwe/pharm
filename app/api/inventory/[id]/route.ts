import { z } from "zod";

import { decideStockMovement } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({ status: z.enum(["Approved", "Rejected"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("stock.approve", async (actor) => decideStockMovement(actor, id, schema.parse(await request.json()).status));
}
