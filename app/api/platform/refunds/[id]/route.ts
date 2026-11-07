import { z } from "zod";

import { decideRefund } from "@/lib/billing/refunds";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(500).default("") });

/** Approve (sends the refund to Paystack) or reject a requested refund. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("billing.manage", async (actor) => {
    const input = schema.parse(await request.json());
    return decideRefund(actor, id, input.decision, input.note);
  });
}
