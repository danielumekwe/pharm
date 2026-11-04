import { z } from "zod";

import { createOutlet } from "@/lib/erp/admin";
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

export async function POST(request: Request) {
  return guarded("outlets.manage", async (actor) => createOutlet(actor, z.object(base).parse(await request.json())), 201);
}
