import { z } from "zod";

import { transitionPurchaseOrder } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({
  action: z.enum(["submit", "approve", "cancel", "receive"]),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(0),
        batchNumber: z.string().max(40),
        expiryDate: z.string(),
        manufacturingDate: z.string().optional(),
        supplierBatchRef: z.string().max(60).optional(),
        regulatoryNumber: z.string().max(20).optional(),
      }),
    )
    .optional(),
  invoiceNumber: z.string().max(60).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Fine-grained checks (approve / receive) happen inside the service.
  return guarded("purchase.view", async (actor) => {
    const body = schema.parse(await request.json());
    return transitionPurchaseOrder(actor, id, body.action, body.lines ?? [], body.invoiceNumber);
  });
}
