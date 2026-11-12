import { z } from "zod";

import { listDevices, registerDevice } from "@/lib/erp/offline-devices";
import { guarded } from "@/lib/session";

const schema = z.object({
  name: z.string().max(60),
  platform: z.string().max(40).optional(),
  outletId: z.string().min(1).max(80),
  publicKey: z.string().min(40).max(400),
});

/** Super Admins see every device of the pharmacy; other users their own. */
export async function GET() {
  return guarded("dashboard.view", (actor) => listDevices(actor));
}

/** Registers this device for offline use (signed-in user, online). */
export async function POST(request: Request) {
  return guarded(
    "dashboard.view",
    async (actor) => registerDevice(actor, { ...schema.parse(await request.json()), userAgent: request.headers.get("user-agent") ?? undefined }),
    201,
  );
}
