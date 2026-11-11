import { z } from "zod";

import { previewImport } from "@/lib/erp/inventory-import";
import { guarded } from "@/lib/session";

const schema = z.object({
  kind: z.enum(["catalogue", "stock", "both"]).optional(),
  mapping: z.record(z.string().max(40), z.union([z.number().int().min(0), z.null()])).optional(),
  options: z.object({ outletId: z.string().min(1).max(80), dateFormat: z.enum(["DMY", "MDY"]), priceBasis: z.enum(["base", "unit"]) }).optional(),
  edits: z.record(z.string().max(8), z.record(z.string().max(40), z.string().max(500))).optional(),
  decisions: z
    .record(z.string().max(8), z.union([z.object({ action: z.literal("match"), productId: z.string().max(120) }), z.object({ action: z.enum(["create", "skip"]) })]))
    .optional(),
});

/** Builds the preview. Nothing is written to products, batches or stock. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("inventory.import", async (actor) => previewImport(actor, id, schema.parse(await request.json())));
}
