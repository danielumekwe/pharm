import { z } from "zod";

import { salesHistory } from "@/lib/erp/pos";
import { createSale, getSalesKpis, visibleSales } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const discount = z.union([z.number().min(0), z.object({ type: z.enum(["percent", "amount"]), value: z.number().min(0) })]);

const saleSchema = z.object({
  outletId: z.string().min(1),
  customerId: z.string().nullable(),
  paymentMethod: z.enum(["Cash", "Card", "Transfer", "Credit", "HMO"]).optional(),
  amountPaid: z.number().min(0).optional(),
  payments: z.array(z.object({ method: z.enum(["Cash", "Card", "Transfer"]), amount: z.number().min(0), reference: z.string().max(60).optional() })).max(6).optional(),
  prescriptionRef: z.string().max(60).optional(),
  lines: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive(), packagingId: z.string().max(80).optional(), discount: discount.optional() }))
    .min(1)
    .max(60),
  globalDiscount: z.object({ type: z.enum(["percent", "amount"]), value: z.number().min(0) }).optional(),
  walkIn: z.object({ name: z.string().max(80).optional(), phone: z.string().max(30).optional() }).optional(),
  customerKind: z.enum(["Normal", "Family"]).optional(),
  heldId: z.string().max(80).optional(),
});

/** Sales history: ?from&to&outletId&cashierId&method&status. Cashiers only see their own sales. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filter = (key: string) => url.searchParams.get(key) ?? undefined;
  return guarded("sales.view", (actor) => {
    const history = salesHistory(actor, { from: filter("from"), to: filter("to"), outletId: filter("outletId"), cashierId: filter("cashierId"), method: filter("method"), status: filter("status") });
    const rows = history.rows.slice(0, 1000);
    const ids = new Set(rows.slice(0, 200).map((row) => row.id));
    // `sales` keeps the full invoices for existing clients; `rows` is the history view with returns and net.
    return { ...history, rows, sales: visibleSales(actor).filter((sale) => ids.has(sale.id)), kpis: getSalesKpis(visibleSales(actor)) };
  });
}

export async function POST(request: Request) {
  return guarded("sales.create", async (actor) => createSale(actor, saleSchema.parse(await request.json())), 201);
}
