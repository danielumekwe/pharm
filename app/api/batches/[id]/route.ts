import { z } from "zod";

import { requestBatchDestruction, setBatchQuarantine } from "@/lib/erp/inventory";
import { guarded } from "@/lib/session";

const schema = z.object({ action: z.enum(["destroy", "quarantine", "release"]), note: z.string().max(200).default("") });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded(["stock.request", "alerts.manage"], async (actor) => {
    const body = schema.parse(await request.json());
    if (body.action === "destroy") return requestBatchDestruction(actor, id, body.note);
    return setBatchQuarantine(actor, id, body.action === "quarantine", body.note);
  });
}
