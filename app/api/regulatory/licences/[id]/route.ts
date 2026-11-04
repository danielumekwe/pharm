import { z } from "zod";

import { updateLicence } from "@/lib/erp/regulatory";
import { guarded } from "@/lib/session";

const schema = z.object({ pcnLicense: z.string().max(40), licenceExpiry: z.string().max(10) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("regulatory.manage", async (actor) => updateLicence(actor, id, schema.parse(await request.json())));
}
