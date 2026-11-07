import { NextResponse } from "next/server";
import { z } from "zod";

import { platformQuery, withDatabaseTransaction } from "@/lib/db/database";
import { users } from "@/lib/data";
import { recordAudit } from "@/lib/erp/services";
import { consumeToken } from "@/lib/saas/auth-tokens";
import { clientAddress, hit, RateLimitError } from "@/lib/saas/rate-limit";
import { runInTenant } from "@/lib/saas/tenant";

const schema = z.object({ token: z.string().max(100) });

/** Public: accepts an invitation to join another pharmacy with an existing account (from the emailed link). */
export async function POST(request: Request) {
  try {
    hit(`join:ip:${await clientAddress()}`, 30, 15 * 60_000);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const token = await consumeToken(parsed.data.token, "join_pharmacy");
    if (!token?.tenantId) return NextResponse.json({ error: "This invitation is invalid, already used, or expired. Ask the pharmacy to send a new one." }, { status: 400 });
    const tenantId = token.tenantId;
    const [joined] = await platformQuery<Array<{ user_id: string }>>((query) =>
      query(`UPDATE tenant_memberships SET status = 'ACTIVE', updated_at = now() WHERE tenant_id = $1 AND user_id = $2 AND status = 'INVITED' RETURNING user_id`, [tenantId, token.userId]),
    );
    if (!joined) return NextResponse.json({ error: "This invitation is no longer open." }, { status: 400 });
    await runInTenant(tenantId, () => withDatabaseTransaction(() => {
      const member = users.find((row) => row.id === token.userId);
      if (member) recordAudit(member, { action: "users.joined", entity: "User", entityId: member.id, summary: `${member.name} accepted the invitation and joined with their existing account`, outletId: member.outletId });
    }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    console.error("[join]", error);
    return NextResponse.json({ error: "Joining is unavailable right now." }, { status: 503 });
  }
}
