import { z } from "zod";

import { refundRequestSchema, refundsAwaitingApproval, requestRefund } from "@/lib/billing/refunds";
import { platformGuarded } from "@/lib/platform/session";

/** Refunds waiting for a second approval. */
export async function GET() {
  return platformGuarded("billing.manage", async () => ({ refunds: await refundsAwaitingApproval() }));
}

/** Requests a refund of a successful payment (needs a second approver unless the policy says otherwise). */
export async function POST(request: Request) {
  return platformGuarded("billing.manage", async (actor) => {
    const input = refundRequestSchema.extend({ paymentId: z.string().min(1).max(80) }).parse(await request.json());
    return requestRefund(actor, input.paymentId, { amount: input.amount, reason: input.reason });
  }, 201);
}
