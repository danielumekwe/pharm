import { z } from "zod";

import { commitImport } from "@/lib/erp/inventory-import";
import { guarded } from "@/lib/session";

const schema = z.object({ confirm: z.boolean(), token: z.string().max(80), chunk: z.number().int().min(0).max(10_000) });

/** Imports one part (chunk) of a confirmed preview. Each part is its own transaction; repeats are ignored. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("inventory.import", async (actor) => commitImport(actor, id, schema.parse(await request.json())));
}
