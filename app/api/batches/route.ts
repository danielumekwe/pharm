import { z } from "zod";

import { getBatchesServer } from "@/lib/data";
import { receiveDirect } from "@/lib/erp/inventory";
import { scopeByOutlet } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({
  productId: z.string().min(1),
  supplierId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: z.number().positive(),
  batchNumber: z.string().min(1).max(40),
  manufacturingDate: z.string().min(8),
  expiryDate: z.string().min(8),
  reason: z.string().min(3).max(200),
});

export async function GET() {
  return guarded("stock.view", async (actor) => scopeByOutlet(actor, await getBatchesServer(), (batch) => batch.assignedOutletId));
}

/** Direct goods receipt (no purchase order). */
export async function POST(request: Request) {
  return guarded("purchase.receive", async (actor) => receiveDirect(actor, schema.parse(await request.json())), 201);
}
