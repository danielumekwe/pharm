import { NextResponse } from "next/server";

import { withDatabaseTransaction } from "@/lib/db/database";
import { saleReceipt } from "@/lib/erp/pos";
import { DomainError } from "@/lib/erp/services";
import { receiptPdf } from "@/lib/pdf/receipt-pdf";
import { getActor } from "@/lib/session";

/** Receipt as JSON or PDF. ?print=1 counts a print (the second and later prints are audited reprints). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  try {
    return await withDatabaseTransaction(async () => {
      const actor = await getActor();
      if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
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
