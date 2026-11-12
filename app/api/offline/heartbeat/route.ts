import { z } from "zod";

import { authenticateDevice, deviceHeartbeat, proofFromHeaders } from "@/lib/erp/offline-devices";
import { resolvedForDevice } from "@/lib/erp/offline-sync";
import { guarded } from "@/lib/session";

const schema = z.object({ pending: z.number().int().min(0).optional(), failed: z.number().int().min(0).optional(), counts: z.record(z.string().max(30), z.number().int().min(0)).optional() });

/** Device check-in: reports local status; a revoked device gets 410 and removes its protected data. */
export async function POST(request: Request) {
  return guarded("dashboard.view", async (actor) => {
    const device = await authenticateDevice(actor, proofFromHeaders(request.headers), "POST", "/api/offline/heartbeat");
    return { ...(await deviceHeartbeat(device, schema.parse(await request.json()))), resolved: await resolvedForDevice(device.id) };
  });
}
