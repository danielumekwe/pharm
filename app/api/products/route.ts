import { z } from "zod";

import { getProductsServer } from "@/lib/data";
import { registerProduct } from "@/lib/erp/products";
import { REGISTRATION_STATUSES } from "@/lib/erp/types";
import { scopeByOutlet } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const money = z.number().min(0).nullable().optional();
const text = (max: number) => z.string().max(max).optional();

const schema = z.object({
  name: z.string().max(120),
  sku: text(32),
  genericName: text(120),
  category: z.string().max(60),
  productType: text(60),
  dosageForm: text(60),
  strength: text(40),
  size: text(40),
  manufacturer: text(120),
  supplierId: text(60),
  description: text(1000),
  outletId: z.string().min(1),
  lifecycle: z.enum(["ACTIVE", "INACTIVE", "DISCONTINUED"]).optional(),
  rxOnly: z.boolean().optional(),
  controlled: z.boolean().optional(),
  minStock: z.number().int().min(0).optional(),
  maxStock: z.number().int().min(0).optional(),
  packaging: z
    .array(
      z.object({
        name: z.string().max(40),
        contains: z.number(),
        purchasePrice: money,
        sellingPrice: money,
        wholesalePrice: money,
        minSellingPrice: money,
        sellable: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(6),
  pricing: z.object({ purchasePrice: money, sellingPrice: money, wholesalePrice: money, minSellingPrice: money }),
  barcodeMode: z.enum(["none", "manufacturer", "internal"]),
  barcodes: z.array(z.object({ code: text(48), format: z.enum(["EAN13", "UPCA", "CODE128"]).optional(), packagingIndex: z.number().int().min(0).optional() })).max(12).optional(),
  regulatory: z
    .object({
      nafdacNumber: text(20),
      status: z.enum(REGISTRATION_STATUSES).optional(),
      approvalDate: text(10),
      renewalDate: text(10),
      expiryDate: text(10),
      localRepresentative: text(120),
      notes: text(300),
    })
    .optional(),
  openingStock: z
    .array(
      z.object({
        batchNumber: z.string().max(40),
        manufacturingDate: z.string().max(10),
        expiryDate: z.string().max(10),
        receivingDate: text(10),
        supplierId: text(60),
        supplierBatchRef: text(60),
        regulatoryNumber: text(20),
        packagingIndex: z.number().int().min(0).optional(),
        quantity: z.number().int().min(0),
        unitCost: money,
      }),
    )
    .max(20)
    .optional(),
});

export async function GET() {
  return guarded("products.view", async (actor) => scopeByOutlet(actor, await getProductsServer(), (product) => product.outletId));
}

/** Full product registration (general, barcode, packaging, pricing, regulatory and opening stock). */
export async function POST(request: Request) {
  return guarded("products.manage", async (actor) => {
    const body = schema.parse(await request.json());
    return registerProduct(actor, { ...body, pricing: body.pricing, openingStock: body.openingStock?.map((row) => ({ ...row, unitCost: row.unitCost ?? undefined })) });
  }, 201);
}
