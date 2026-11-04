import { z } from "zod";

import { acknowledgeAlert, resolveAlert } from "@/lib/erp/alerts";
import { guarded } from "@/lib/session";

const schema = z.object({ action: z.enum(["acknowledge", "resolve"]), note: z.string().max(300).default("") });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("alerts.manage", async (actor) => {
    const body = schema.parse(await request.json());
    return body.action === "acknowledge" ? acknowledgeAlert(actor, id, body.note) : resolveAlert(actor, id, body.note);
  });
}
