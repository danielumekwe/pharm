import { syncRefund } from "@/lib/billing/refunds";
import { platformGuarded } from "@/lib/platform/session";

/** Asks Paystack for the refund's current status. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("billing.manage", async () => syncRefund(id));
}
