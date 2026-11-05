import { z } from "zod";

import { addBarcode, removeBarcode } from "@/lib/erp/products";
import { guarded } from "@/lib/session";

const schema = z.object({
  source: z.enum(["MANUFACTURER", "INTERNAL"]),
  code: z.string().max(48).optional(),
  format: z.enum(["EAN13", "UPCA", "CODE128"]).optional(),
  packagingId: z.string().max(80).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("products.manage", async (actor) => addBarcode(actor, id, schema.parse(await request.json())), 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const code = new URL(request.url).searchParams.get("code") ?? "";
  return guarded("products.manage", async (actor) => removeBarcode(actor, id, code));
}
