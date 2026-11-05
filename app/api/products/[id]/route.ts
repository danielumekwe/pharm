import { z } from "zod";

import { updateItem } from "@/lib/erp/inventory";
import { productDetail, updateProductMaster } from "@/lib/erp/products";
import { guarded } from "@/lib/session";

const money = z.number().min(0).nullable().optional();

const schema = z.object({
  // Quick edit (item master modal)
  purchasePrice: z.number().positive().optional(),
  sellingPrice: z.number().positive().optional(),
  minStock: z.number().int().min(0).optional(),
  nafdacNumber: z.string().max(20).optional(),
  rxOnly: z.boolean().optional(),
  controlled: z.boolean().optional(),
  restricted: z.boolean().optional(),
  allLocations: z.boolean().optional(),
  // Master data (product page)
  genericName: z.string().max(120).optional(),
  category: z.string().max(60).optional(),
  productType: z.string().max(60).optional(),
  dosageForm: z.string().max(60).optional(),
  strength: z.string().max(40).optional(),
  size: z.string().max(40).optional(),
  manufacturer: z.string().max(120).optional(),
  supplierId: z.string().max(60).optional(),
  description: z.string().max(1000).optional(),
  lifecycle: z.enum(["ACTIVE", "INACTIVE", "DISCONTINUED"]).optional(),
  pricing: z.object({ purchasePrice: money, sellingPrice: money, wholesalePrice: money, minSellingPrice: money }).optional(),
  levelPrices: z.record(z.string(), z.object({ purchasePrice: money, sellingPrice: money, wholesalePrice: money, minSellingPrice: money, sellable: z.boolean().optional() })).optional(),
  packaging: z.array(z.object({ name: z.string().max(40), contains: z.number(), sellable: z.boolean().optional() })).min(1).max(6).optional(),
});

const QUICK = ["purchasePrice", "sellingPrice", "minStock", "nafdacNumber", "rxOnly", "controlled", "restricted", "allLocations"] as const;
const MASTER = ["genericName", "category", "productType", "dosageForm", "strength", "size", "manufacturer", "supplierId", "description", "lifecycle", "pricing", "levelPrices", "packaging"] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("products.view", async (actor) => productDetail(actor, id));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("products.manage", async (actor) => {
    const body = schema.parse(await request.json());
    let result: unknown = null;
    if (QUICK.some((key) => body[key] !== undefined)) result = updateItem(actor, id, body);
    if (MASTER.some((key) => body[key] !== undefined)) result = updateProductMaster(actor, id, body);
    return result ?? productDetail(actor, id).product;
  });
}
