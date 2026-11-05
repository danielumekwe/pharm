import { z } from "zod";

import { heldSalesFor, saveHeldSale } from "@/lib/erp/pos";
import { guarded } from "@/lib/session";

const discount = z.object({ type: z.enum(["percent", "amount"]), value: z.number().min(0) });
const schema = z.object({
  id: z.string().max(80).optional(),
  kind: z.enum(["HELD", "DRAFT"]),
  outletId: z.string().min(1),
  label: z.string().max(60).optional(),
  cart: z.object({
    lines: z.array(z.object({ productId: z.string().min(1), packagingId: z.string().max(80).optional(), quantity: z.number().int().positive(), discount: discount.optional() })).min(1).max(60),
    customerId: z.string().max(60).nullable().optional(),
    walkIn: z.object({ name: z.string().max(80).optional(), phone: z.string().max(30).optional() }).optional(),
    customerKind: z.enum(["Normal", "Family"]).optional(),
    globalDiscount: discount.optional(),
    prescriptionRef: z.string().max(60).optional(),
  }),
});

export async function GET(request: Request) {
  const outletId = new URL(request.url).searchParams.get("outletId");
  return guarded("sales.create", (actor) => heldSalesFor(actor, outletId));
}

export async function POST(request: Request) {
  return guarded("sales.create", async (actor) => saveHeldSale(actor, schema.parse(await request.json())), 201);
}
