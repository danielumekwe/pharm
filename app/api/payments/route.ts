import { z } from "zod";

import { recordPayment } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({
  direction: z.enum(["IN", "OUT"]),
  partyType: z.enum(["Customer", "Supplier"]),
  partyId: z.string().min(1),
  documentRef: z.string().max(60).optional(),
  method: z.enum(["Cash", "Card", "Transfer", "HMO"]),
  account: z.string().min(1).max(60),
  amount: z.number().positive(),
});

export async function POST(request: Request) {
  return guarded("finance.create", async (actor) => recordPayment(actor, schema.parse(await request.json())), 201);
}
