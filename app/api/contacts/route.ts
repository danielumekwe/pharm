import { z } from "zod";

import { createCustomer, createSupplier } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("customer"),
    name: z.string().min(2).max(120),
    type: z.enum(["Walk-in", "Retail", "Corporate", "HMO", "Clinic"]),
    phone: z.string().max(40),
    email: z.string().max(120),
    creditLimit: z.number().min(0),
    outletId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("supplier"),
    name: z.string().min(2).max(120),
    contactPerson: z.string().max(120),
    phone: z.string().max(40),
    email: z.string().max(120),
    pcnLicense: z.string().max(60),
    paymentTermsDays: z.number().int().min(0).max(180),
    categories: z.string().max(200),
  }),
]);

export async function POST(request: Request) {
  return guarded(
    "contacts.manage",
    async (actor) => {
      const body = schema.parse(await request.json());
      return body.kind === "customer" ? createCustomer(actor, body) : createSupplier(actor, body);
    },
    201,
  );
}
