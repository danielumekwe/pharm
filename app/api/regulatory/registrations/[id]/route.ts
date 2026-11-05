import { z } from "zod";

import { updateRegistration } from "@/lib/erp/regulatory";
import { REGISTRATION_STATUSES } from "@/lib/erp/types";
import { guarded } from "@/lib/session";

const schema = z.object({ nafdacNumber: z.string().max(20), issuedDate: z.string().max(10), expiryDate: z.string().max(10), notes: z.string().max(300).optional(), status: z.enum(REGISTRATION_STATUSES).optional(), renewalDate: z.string().max(10).optional(), localRepresentative: z.string().max(120).optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("regulatory.manage", async (actor) => updateRegistration(actor, id, schema.parse(await request.json())));
}
