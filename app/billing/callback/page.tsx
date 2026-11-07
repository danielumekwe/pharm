import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AuthCard, Notice } from "@/components/auth-card";
import { settlePayment } from "@/lib/billing/service";
import { withDatabaseTransaction } from "@/lib/db/database";
import { getActor } from "@/lib/session";

export const metadata = { title: "Payment" };

/**
 * Where Paystack sends the payer back. The query string is not trusted: the payment is checked with Paystack
 * on the server, and details are shown only to the pharmacy the payment belongs to.
 */
export default async function BillingCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const reference = typeof params.reference === "string" ? params.reference.slice(0, 80) : typeof params.trxref === "string" ? params.trxref.slice(0, 80) : "";
  if (!reference) redirect("/subscription");
  const settlement = await settlePayment(reference, "callback");
  const viewer = await withDatabaseTransaction(() => getActor()).catch(() => null);
  const own = Boolean(viewer?.tenantId && viewer.tenantId === settlement.tenantId);
  if (own && (settlement.outcome === "activated" || settlement.outcome === "already")) redirect("/subscription?paid=1");
  return (
    <AuthCard title="Payment">
      <div className="space-y-4">
        {own ? (
          <Notice tone={settlement.outcome === "pending" ? "info" : "error"}>{settlement.message}</Notice>
        ) : (
          <Notice tone="info">Thank you. If this payment was for your pharmacy, sign in and open Subscription and billing to see it.</Notice>
        )}
        <Link href={own ? "/subscription" : "/"} className="block text-center font-medium text-green-700 hover:underline">{own ? "Back to subscription and billing" : "Go to sign in"}</Link>
      </div>
    </AuthCard>
  );
}
