import { NextResponse } from "next/server";
import { z } from "zod";

import { flushDatabase, withDatabaseTransaction } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { acceptInvite } from "@/lib/erp/users";
import { invitationTenant } from "@/lib/saas/identity";
import { runInTenant } from "@/lib/saas/tenant";

const schema = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(128) });

/** Public endpoint: a staff member activates their account from an invitation link, in the inviting pharmacy. */
export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const tenantId = await invitationTenant(body.token);
    if (!tenantId) return NextResponse.json({ error: "This invitation link is invalid, already used, or expired." }, { status: 404 });
    return await runInTenant(tenantId, () => withDatabaseTransaction(async () => {
      const result = await acceptInvite(body.token, body.password);
      await flushDatabase();
      return NextResponse.json(result);
    }));
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
