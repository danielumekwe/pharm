import { z } from "zod";

import { rollbackImport } from "@/lib/erp/inventory-import";
import { guarded } from "@/lib/session";

const schema = z.object({ reason: z.string().max(500) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("inventory.import", async (actor) => rollbackImport(actor, id, schema.parse(await request.json()).reason));
}
