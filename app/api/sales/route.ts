import { z } from "zod";

import { createSale, getSalesKpis, scopeByOutlet } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import { guarded } from "@/lib/session";

const saleSchema = z.object({
  outletId: z.string().min(1),
  customerId: z.string().nullable(),
  paymentMethod: z.enum(["Cash", "Card", "Transfer", "Credit", "HMO"]),
  amountPaid: z.number().min(0).optional(),
  prescriptionRef: z.string().max(60).optional(),
  lines: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive(), discount: z.number().min(0).optional() }))
    .min(1)
    .max(50),
});

export async function GET() {
  return guarded("sales.view", (actor) => {
    const rows = scopeByOutlet(actor, getStore().sales, (sale) => sale.outletId);
    return { kpis: getSalesKpis(rows), sales: rows.slice(0, 200) };
  });
}

export async function POST(request: Request) {
  return guarded("sales.create", async (actor) => createSale(actor, saleSchema.parse(await request.json())), 201);
}
