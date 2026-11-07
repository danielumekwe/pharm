import { z } from "zod";

import { createTransfer, transfersFor } from "@/lib/erp/transfers";
import { guarded } from "@/lib/session";

const schema = z.object({
  fromOutletId: z.string().min(1),
  toOutletId: z.string().min(1),
  lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() })).min(1).max(50),
  notes: z.string().max(300).optional(),
  submit: z.boolean().optional(),
});

export async function GET() {
  return guarded("stock.view", (actor) => transfersFor(actor));
}

export async function POST(request: Request) {
  return guarded("stock.request", async (actor) => await createTransfer(actor, schema.parse(await request.json())), 201);
}
