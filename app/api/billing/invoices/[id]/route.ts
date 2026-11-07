import { NextResponse } from "next/server";

import { withDatabaseTransaction } from "@/lib/db/database";
import { invoiceById } from "@/lib/billing/service";
import { DomainError } from "@/lib/erp/services";
import { invoicePdf } from "@/lib/pdf/invoice-pdf";
import { getActor } from "@/lib/session";

/** The pharmacy's own invoice as a PDF (any signed-in member of that pharmacy with settings or finance access). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withDatabaseTransaction(async () => {
    const actor = await getActor();
    if (!actor?.tenantId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    if (!actor.permissions.includes("settings.manage") && !actor.permissions.includes("finance.view")) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    try {
      const invoice = await invoiceById(id, actor.tenantId);
      return new NextResponse(new Uint8Array(await invoicePdf(invoice)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${invoice.number}.pdf"`, "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  });
}
