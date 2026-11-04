import { z } from "zod";

import { updateItem } from "@/lib/erp/inventory";
import { guarded } from "@/lib/session";

const schema = z.object({
  purchasePrice: z.number().positive().optional(),
  sellingPrice: z.number().positive().optional(),
  minStock: z.number().int().min(0).optional(),
  nafdacNumber: z.string().max(20).optional(),
  rxOnly: z.boolean().optional(),
  controlled: z.boolean().optional(),
  restricted: z.boolean().optional(),
  allLocations: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("products.manage", async (actor) => updateItem(actor, id, schema.parse(await request.json())));
}
