import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AuthCard, Notice } from "@/components/auth-card";
import { settleCoinPurchase } from "@/lib/ai/purchases";
import { withDatabaseTransaction } from "@/lib/db/database";
import { getActor } from "@/lib/session";

export const metadata = { title: "AI coin purchase" };

/**
 * Where Paystack sends the buyer back. The query string is not trusted: the payment is verified with Paystack
 * on the server (and credited at most once); details are shown only to the pharmacy that made the purchase.
 */
export default async function AiCoinCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const reference = typeof params.reference === "string" ? params.reference.slice(0, 80) : typeof params.trxref === "string" ? params.trxref.slice(0, 80) : "";
  if (!reference) redirect("/ai-wallet");
  const settlement = await settleCoinPurchase(reference, "callback");
  const viewer = await withDatabaseTransaction(() => getActor()).catch(() => null);
  const own = Boolean(viewer?.tenantId && viewer.tenantId === settlement.tenantId);
  if (own && (settlement.outcome === "credited" || settlement.outcome === "already")) redirect("/ai-wallet?purchased=1");
  return (
    <AuthCard title="AI coin purchase">
      <div className="space-y-4">
        {own ? (
          <Notice tone={settlement.outcome === "pending" ? "info" : "error"}>{settlement.message}</Notice>
        ) : (
          <Notice tone="info">Thank you. If this purchase was for your pharmacy, sign in and open AI Wallet to see your coins.</Notice>
        )}
        <Link href={own ? "/ai-wallet" : "/"} className="block text-center font-medium text-green-700 hover:underline">
          {own ? "Back to AI Wallet" : "Go to sign in"}
        </Link>
      </div>
    </AuthCard>
  );
}
