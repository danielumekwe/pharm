import { z } from "zod";

import { updateOutlet } from "@/lib/erp/admin";
import { guarded } from "@/lib/session";

const base = {
  name: z.string().max(120),
  code: z.string().max(10),
  type: z.enum(["RETAIL", "WAREHOUSE"]),
  address: z.string().max(200),
  manager: z.string().max(120),
  phone: z.string().max(30),
  pcnLicense: z.string().max(40),
  licenceExpiry: z.string().max(10),
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("outlets.manage", async (actor) => updateOutlet(actor, id, z.object({ ...base, status: z.enum(["ACTIVE", "CLOSED"]) }).parse(await request.json())));
}
