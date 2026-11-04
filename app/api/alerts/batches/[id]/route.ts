import { z } from "zod";

import { handleExpiredBatch } from "@/lib/erp/alerts";
import { guarded } from "@/lib/session";

const schema = z.object({ action: z.enum(["quarantine", "return", "dispose"]), note: z.string().max(300).default("") });

/** Expired-stock handling: quarantine, return to supplier, or disposal (the last two need a second approver). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("alerts.manage", async (actor) => {
    const body = schema.parse(await request.json());
    return handleExpiredBatch(actor, id, body.action, body.note);
  });
}
