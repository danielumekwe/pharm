import { z } from "zod";

import { setThreshold, inheritThreshold } from "@/lib/erp/alerts";
import { guarded } from "@/lib/session";

const schema = z.union([
  z.object({ productId: z.string().min(1), minStock: z.number().int(), maxStock: z.number().int().nullable() }),
  z.object({ productId: z.string().min(1), inherit: z.literal(true) }),
]);

/** Per-product, per-outlet minimum stock and target level. */
export async function PATCH(request: Request) {
  return guarded("alerts.manage", async (actor) => {
    const body = schema.parse(await request.json());
    if ("inherit" in body) return inheritThreshold(actor, body.productId);
    return setThreshold(actor, body.productId, body.minStock, body.maxStock);
  });
}
