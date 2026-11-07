import { createTenantForCustomer, listTenants, platformCreateSchema } from "@/lib/platform/tenants";
import { platformGuarded } from "@/lib/platform/session";

/** Pharmacies on the platform (account, plan, subscription, usage counts). ?q=&status=&subscription=&plan=&deletion=1 */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  return platformGuarded("tenants.view", async () => ({
    tenants: await listTenants({ q: search.get("q") ?? undefined, status: search.get("status") ?? undefined, subscription: search.get("subscription") ?? undefined, plan: search.get("plan") ?? undefined, deletion: search.get("deletion") === "1" }),
  }));
}

/** Web365 creates a pharmacy for a customer; the owner gets a link to set their password. */
export async function POST(request: Request) {
  return platformGuarded("tenants.manage", async (actor) => createTenantForCustomer(actor, platformCreateSchema.parse(await request.json())), 201);
}
