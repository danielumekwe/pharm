import { z } from "zod";

import { setSupplierStatus } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.object({ status: z.enum(["Approved", "Pending verification", "Suspended"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("contacts.view", async (actor) => setSupplierStatus(actor, id, schema.parse(await request.json()).status));
}
