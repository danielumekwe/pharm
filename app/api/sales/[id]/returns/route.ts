import { z } from "zod";

import { createSaleReturn } from "@/lib/erp/returns";
import { guarded } from "@/lib/session";

const schema = z.object({
  lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(0) })).min(1).max(50),
  reason: z.string().max(200),
  refundMethod: z.enum(["Cash", "Card", "Transfer", "Account credit"]),
  restock: z.boolean(),
});

/** Record a customer return / refund against a completed invoice. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("sales.void", async (actor) => createSaleReturn(actor, id, schema.parse(await request.json())), 201);
}
