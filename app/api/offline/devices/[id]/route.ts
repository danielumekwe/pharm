import { z } from "zod";

import { updateDevice } from "@/lib/erp/offline-devices";
import { guarded } from "@/lib/session";

const schema = z.object({ name: z.string().max(60).optional(), revoke: z.boolean().optional(), reason: z.string().max(300).optional() });

/** Rename or revoke (Super Admins: any device; users: their own). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("dashboard.view", async (actor) => updateDevice(actor, id, schema.parse(await request.json())));
}
