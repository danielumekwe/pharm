import { z } from "zod";

import { authenticateDevice, proofFromHeaders } from "@/lib/erp/offline-devices";
import { applyOperation } from "@/lib/erp/offline-sync";
import { guarded } from "@/lib/session";

const schema = z.object({ operation: z.unknown() });

/**
 * Uploads ONE offline operation (session + device signature). The response states its outcome explicitly;
 * the device marks it synced only after an "applied" or "duplicate" answer.
 */
export async function POST(request: Request) {
  return guarded("dashboard.view", async (actor) => {
    const device = await authenticateDevice(actor, proofFromHeaders(request.headers), "POST", "/api/offline/sync");
    return applyOperation(actor, device, schema.parse(await request.json()).operation);
  });
}
