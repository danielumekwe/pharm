import { z } from "zod";

import { verifyPayment } from "@/lib/erp/offline-reconcile";
import { guarded } from "@/lib/session";

const schema = z.object({ outcome: z.enum(["verified", "not-received"]), note: z.string().max(500).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  return guarded(["sales.supervise", "finance.approve"], async (actor) => {
    const input = schema.parse(await request.json());
    return verifyPayment(actor, saleId, input.outcome, input.note ?? "");
  });
}
