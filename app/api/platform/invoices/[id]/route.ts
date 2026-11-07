import { NextResponse } from "next/server";

import { invoiceById } from "@/lib/billing/service";
import { invoicePdf } from "@/lib/pdf/invoice-pdf";
import { platformGuarded } from "@/lib/platform/session";

/** Any pharmacy's invoice, for Web365 staff. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("tenants.view", async () => {
    const invoice = await invoiceById(id, null);
    return new NextResponse(new Uint8Array(await invoicePdf(invoice)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${invoice.number}.pdf"`, "Cache-Control": "private, no-store" } });
  });
}
