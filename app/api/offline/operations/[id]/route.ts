import { z } from "zod";

import { closeOperation, retryOperation } from "@/lib/erp/offline-reconcile";
import { guarded } from "@/lib/session";

const schema = z.object({ action: z.enum(["retry", "close"]), note: z.string().max(500).optional() });

/** Retry a kept offline record now, or close it with a written reason (stock approvers). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("stock.approve", async (actor) => {
    const input = schema.parse(await request.json());
    return input.action === "retry" ? retryOperation(actor, id) : closeOperation(actor, id, input.note ?? "");
  });
}
