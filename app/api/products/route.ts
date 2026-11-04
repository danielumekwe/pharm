import { z } from "zod";

import { getProductsServer } from "@/lib/data";
import { createItem } from "@/lib/erp/inventory";
import { scopeByOutlet } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({
  name: z.string().min(2).max(120),
  genericName: z.string().max(120),
  category: z.string().min(1).max(60),
  manufacturer: z.string().max(120),
  strength: z.string().max(40),
  uom: z.string().max(20),
  purchasePrice: z.number().positive(),
  sellingPrice: z.number().positive(),
  minStock: z.number().int().min(0),
  barcode: z.string().max(40),
  nafdacNumber: z.string().max(20),
  rxOnly: z.boolean(),
  controlled: z.boolean(),
  outletId: z.string().min(1),
});

export async function GET() {
  return guarded("products.view", async (actor) => scopeByOutlet(actor, await getProductsServer(), (product) => product.outletId));
}

export async function POST(request: Request) {
  return guarded("products.manage", async (actor) => createItem(actor, schema.parse(await request.json())), 201);
}
