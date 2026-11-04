import { z } from "zod";

import { createExpense } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({
  category: z.string().min(1).max(60),
  description: z.string().min(3).max(200),
  vendor: z.string().max(120),
  outletId: z.string().min(1),
  amount: z.number().positive(),
  date: z.string(),
});

export async function POST(request: Request) {
  return guarded("finance.create", async (actor) => createExpense(actor, schema.parse(await request.json())), 201);
}
