import { NextResponse } from "next/server";

import { withDatabaseTransaction } from "@/lib/db/database";
import { saleReceipt } from "@/lib/erp/pos";
import { DomainError } from "@/lib/erp/services";
import { receiptPdf } from "@/lib/pdf/receipt-pdf";
import { can } from "@/lib/rbac";
import { getActor } from "@/lib/session";
import { subscriptionAccessProblem } from "@/lib/saas/subscriptions";

/** Receipt as JSON or PDF. ?print=1 counts a print (the second and later prints are audited reprints). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  try {
    return await withDatabaseTransaction(async () => {
      const actor = await getActor();
      if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
      if (!can(actor, "sales.view")) return NextResponse.json({ error: 'Your role does not have the "sales.view" permission.' }, { status: 403 });
      if (!actor.support) {
        const problem = await subscriptionAccessProblem();
        if (problem) return NextResponse.json({ error: problem }, { status: 402 });
      }
      const receipt = saleReceipt(actor, id, { print: url.searchParams.get("print") === "1" });
      if (url.searchParams.get("format") === "pdf") {
        return new NextResponse(new Uint8Array(await receiptPdf(receipt)), {
          headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${receipt.sale.number}.pdf"` },
        });
      }
      return NextResponse.json(receipt);
    });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Could not load the receipt." }, { status: 500 });
  }
}
