import { z } from "zod";

import { createUser } from "@/lib/erp/users";
import { guarded } from "@/lib/session";

const schema = z.object({
  name: z.string().min(3).max(120),
  email: z.string().max(160),
  phone: z.string().max(30),
  staffId: z.string().max(20).optional(),
  role: z.string(),
  outletIds: z.array(z.string()).max(20),
  primaryOutletId: z.string().nullable(),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  credential: z.discriminatedUnion("mode", [z.object({ mode: z.literal("invite") }), z.object({ mode: z.literal("password"), password: z.string().max(128) })]),
  grants: z.array(z.string()).max(40).optional(),
});

export async function POST(request: Request) {
  return guarded("users.manage", async (actor) => createUser(actor, schema.parse(await request.json())), 201);
}
