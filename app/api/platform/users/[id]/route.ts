import { z } from "zod";

import { setStaffStatus } from "@/lib/platform/staff";
import { platformGuarded } from "@/lib/platform/session";

const schema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("staff.manage", async (actor) => setStaffStatus(actor, id, schema.parse(await request.json()).status));
}
