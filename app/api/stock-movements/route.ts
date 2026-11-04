import { z } from "zod";

import { requestStockMovement } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({
  type: z.enum(["Transfer", "Adjustment", "Return", "Issue"]),
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  toOutletId: z.string().optional(),
  reason: z.string().min(3).max(200),
});

export async function POST(request: Request) {
  return guarded("stock.request", async (actor) => requestStockMovement(actor, schema.parse(await request.json())), 201);
}
