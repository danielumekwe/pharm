import { settlePayment } from "@/lib/billing/service";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { platformGuarded } from "@/lib/platform/session";

/** Re-checks a payment with the provider (reconciliation). It is applied only if the provider confirms it. */
export async function POST(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return platformGuarded("tenants.manage", async (actor) => {
    const result = await settlePayment(reference, "manual");
    await recordPlatformAudit(platformActorRef(actor), { action: "billing.recheck", targetType: "Payment", targetId: reference, tenantId: result.tenantId, summary: `Re-checked payment ${reference} with the provider: ${result.outcome}` });
    return result;
  });
}
