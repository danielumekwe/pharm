import { NextResponse } from "next/server";

import { openPurchaseCheckout, preparePurchase } from "@/lib/ai/purchases";
import { withDatabaseTransaction } from "@/lib/db/database";
import { recordAudit } from "@/lib/erp/services";
import { runInTenant } from "@/lib/saas/tenant";
import { guarded } from "@/lib/session";

/**
 * Buy a coin package: { packageId }. The price, coins and pharmacy are taken from the server (any amount,
 * coin count or pharmacy in the request is ignored). Coins are added only after Paystack confirms payment.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { packageId?: unknown };
  let prepared: Awaited<ReturnType<typeof preparePurchase>> | null = null;
  const response = await guarded("ai.coins.purchase", async (actor) => {
    prepared = await preparePurchase(actor, body.packageId);
    return { prepared: true };
  });
  const ready = prepared as Awaited<ReturnType<typeof preparePurchase>> | null;
  if (!response.ok || !ready) return response;
  // Outside any transaction: the pending purchase, then Paystack's checkout page.
  try {
    const checkout = await openPurchaseCheckout(ready);
    await runInTenant(ready.tenantId, () =>
      withDatabaseTransaction(() => {
        recordAudit({ ...ready.actor, role: "SUPER_ADMIN" }, { action: "ai.purchase-started", entity: "AICoinPurchase", entityId: checkout.reference, summary: `Started buying the ${ready.pack.name} AI coin package (${ready.pack.totalCoins} coins for ${ready.pack.currency} ${ready.pack.price.toLocaleString("en-NG")}); reference ${checkout.reference}` });
      }),
    );
    return NextResponse.json({ checkoutUrl: checkout.checkoutUrl, reference: checkout.reference, package: { name: ready.pack.name, coins: ready.pack.totalCoins, price: ready.pack.price, currency: ready.pack.currency } });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "The payment could not be started." }, { status });
  }
}
