import { z } from "zod";

import { registerDevice, unregisterDevice } from "@/lib/erp/alerts";
import { guarded } from "@/lib/session";

const schema = z.object({ token: z.string().min(20).max(4096), platform: z.enum(["android", "ios", "web"]).default("android"), label: z.string().max(80).optional() });

/** Android admin app: register the FCM token for this signed-in user. */
export async function POST(request: Request) {
  return guarded("alerts.view", async (actor) => {
    const body = schema.parse(await request.json());
    const device = registerDevice(actor, body.token, body.platform, body.label);
    return { id: device.id, platform: device.platform, registeredAt: device.registeredAt };
  }, 201);
}

export async function DELETE(request: Request) {
  return guarded("alerts.view", async (actor) => unregisterDevice(actor, z.object({ token: z.string() }).parse(await request.json()).token));
}
