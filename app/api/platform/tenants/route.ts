import { createTenantForCustomer, listTenants, platformCreateSchema } from "@/lib/platform/tenants";
import { platformGuarded } from "@/lib/platform/session";

/** Pharmacies on the platform: account, plan, subscription and usage counts (no business records). */
export async function GET() {
  return platformGuarded("tenants.view", async () => ({ tenants: await listTenants() }));
}

/** Web365 creates a pharmacy for a customer; the owner gets a link to set their password. */
export async function POST(request: Request) {
  return platformGuarded("tenants.manage", async (actor) => createTenantForCustomer(actor, platformCreateSchema.parse(await request.json())), 201);
}
