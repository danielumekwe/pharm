import { z } from "zod";

import { actOnTransfer } from "@/lib/erp/transfers";
import { guarded } from "@/lib/session";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["submit", "approve", "cancel", "dispatch"]), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("reject"), note: z.string().max(300) }),
  z.object({
    action: z.literal("receive"),
    note: z.string().max(300).optional(),
    final: z.boolean().optional(),
    lines: z.array(z.object({ productId: z.string().min(1), batchNumber: z.string().min(1).max(40), quantity: z.number().int().min(0) })).max(200),
  }),
]);

// Fine-grained permission and outlet checks (approve, dispatch, receive) happen in the service.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded(["stock.request", "stock.approve", "purchase.receive"], async (actor) => await actOnTransfer(actor, id, schema.parse(await request.json())));
}
