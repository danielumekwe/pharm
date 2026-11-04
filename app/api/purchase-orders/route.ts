import { z } from "zod";

import { createPurchaseOrder, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { guarded } from "@/lib/session";

const schema = z.object({
  supplierId: z.string().min(1),
  outletId: z.string().min(1),
  expectedDate: z.string().min(8),
  notes: z.string().max(300).optional(),
  submit: z.boolean(),
  lines: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive(), unitCost: z.number().positive() }))
    .min(1)
    .max(50),
});

export async function GET() {
  return guarded("purchase.view", (actor) => scopeByOutlet(actor, getStore().purchaseOrders, (order) => order.outletId));
}

export async function POST(request: Request) {
  return guarded("purchase.create", async (actor) => createPurchaseOrder(actor, schema.parse(await request.json())), 201);
}
