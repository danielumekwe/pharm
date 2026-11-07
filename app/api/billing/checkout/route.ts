import { NextResponse } from "next/server";
import { z } from "zod";

import { withDatabaseTransaction } from "@/lib/db/database";
import { openCheckout, prepareCheckout } from "@/lib/billing/service";
import { DomainError, recordAudit } from "@/lib/erp/services";
import { guarded } from "@/lib/session";
import { runInTenant } from "@/lib/saas/tenant";

const schema = z.object({ planId: z.string().min(1).max(40), billingCycle: z.enum(["MONTHLY", "ANNUAL"]) });

/**
 * The Pharmacy Super Admin picks a plan. The amount is worked out on the server; anything else in the request
 * (an amount, a currency, a pharmacy) is ignored. Works while the subscription has lapsed.
 */
export async function POST(request: Request) {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Choose a plan and a billing cycle." }, { status: 400 });

  // Step 1, in the pharmacy's transaction: permission and quote (a downgrade is just scheduled).
  let prepared: Awaited<ReturnType<typeof prepareCheckout>> | null = null;
  const response = await guarded("settings.manage", async (actor) => {
    if (actor.support) throw new DomainError("Support sessions cannot make payments.", 403);
    prepared = await prepareCheckout(actor, input.data.planId, input.data.billingCycle);
    return prepared.kind === "scheduled" ? { scheduled: true, quote: prepared.quote } : { prepared: true };
  }, 200, { allowLapsed: true });
  const ready = prepared as Awaited<ReturnType<typeof prepareCheckout>> | null;
  if (!response.ok || !ready || ready.kind !== "payment") return response;

  // Step 2, outside any transaction: payment record, then the provider's checkout page.
  try {
    const checkout = await openCheckout(ready);
    await runInTenant(ready.tenantId, () => withDatabaseTransaction(() => {
      recordAudit({ ...ready.actor, role: "SUPER_ADMIN" }, {
        action: "billing.checkout", entity: "Payment", entityId: checkout.paymentId,
        summary: `Started a ${ready.quote.currency} ${ready.quote.amount.toLocaleString("en-NG")} payment for ${ready.quote.planName} (${ready.quote.billingCycle.toLowerCase()}, ${ready.quote.purpose.toLowerCase()}); reference ${checkout.reference}`,
      });
    }));
    return NextResponse.json({ checkoutUrl: checkout.checkoutUrl, reference: checkout.reference, quote: ready.quote });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "The payment could not be started." }, { status });
  }
}
