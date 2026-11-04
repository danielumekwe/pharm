import { z } from "zod";

import { transitionExpense } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({ action: z.enum(["approve", "reject", "pay"]), account: z.string().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("finance.approve", async (actor) => {
    const body = schema.parse(await request.json());
    return transitionExpense(actor, id, body.action, body.account);
  });
}
