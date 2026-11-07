import { z } from "zod";

import { currentTenant } from "@/lib/db/database";
import { DomainError, recordAudit } from "@/lib/erp/services";
import { latestClosure, requestClosure, withdrawClosure } from "@/lib/platform/tenant-admin";
import { guarded } from "@/lib/session";

const schema = z.object({ reason: z.string().max(600), password: z.string().min(1).max(200) });
const tenantId = () => {
  const id = currentTenant()?.id;
  if (!id) throw new DomainError("No pharmacy selected.", 401);
  return id;
};

/** The pharmacy's latest request to close its account. */
export async function GET() {
  return guarded("settings.manage", async () => ({ request: await latestClosure(tenantId()) }), 200, { allowLapsed: true });
}

/** The Super Admin asks Web365 to close the pharmacy (confirmed with their password). */
export async function POST(request: Request) {
  return guarded("settings.manage", async (actor) => {
    const result = await requestClosure(actor, tenantId(), schema.parse(await request.json()));
    recordAudit(actor, { action: "tenant.closure-requested", entity: "Tenant", entityId: tenantId(), summary: "Asked Web365 to close the pharmacy's account" });
    return result;
  }, 201, { allowLapsed: true });
}

/** Withdraws a request that Web365 has not decided yet. */
export async function DELETE() {
  return guarded("settings.manage", async (actor) => {
    const result = await withdrawClosure(actor, tenantId());
    recordAudit(actor, { action: "tenant.closure-withdrawn", entity: "Tenant", entityId: tenantId(), summary: "Withdrew the request to close the pharmacy's account" });
    return result;
  }, 200, { allowLapsed: true });
}
