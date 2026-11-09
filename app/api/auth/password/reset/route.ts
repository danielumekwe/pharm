import { NextResponse } from "next/server";
import { z } from "zod";

import { platformQuery, withDatabaseTransaction } from "@/lib/db/database";
import { users } from "@/lib/data";
import { recordAudit } from "@/lib/erp/services";
import { hashPassword } from "@/lib/password";
import { consumeToken } from "@/lib/saas/auth-tokens";
import { strongPassword } from "@/lib/saas/registration";
import { runInTenant } from "@/lib/saas/tenant";

const schema = z.object({ token: z.string().max(100), password: z.string().max(128) });

/** Public: sets a new password from a reset link. Every existing session of the account is signed out. */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    // Check the new password first, so a weak one does not use up the link.
    const password = strongPassword.safeParse(parsed.data.password);
    if (!password.success) return NextResponse.json({ error: password.error.issues[0]?.message ?? "Choose a stronger password." }, { status: 422 });
    const userId = (await consumeToken(parsed.data.token, "reset_password"))?.userId;
    if (!userId) return NextResponse.json({ error: "This reset link is invalid, already used, or expired. Ask for a new one." }, { status: 400 });

    const changedAt = new Date().toISOString();
    const tenants = await platformQuery<Array<{ tenant_id: string }>>(async (query) => {
      await query(`UPDATE users SET password_hash = $1, password = NULL, password_changed_at = $2 WHERE id = $3`, [hashPassword(password.data), changedAt, userId]);
      return query(`SELECT tenant_id FROM tenant_memberships WHERE user_id = $1 AND status <> 'DEACTIVATED'`, [userId]);
    });
    // Recorded in the audit trail of every pharmacy the person works for.
    for (const { tenant_id: tenantId } of tenants) {
      await runInTenant(tenantId, () => withDatabaseTransaction(() => {
        const account = users.find((row) => row.id === userId);
        if (account) recordAudit(account, { action: "auth.password-reset", entity: "User", entityId: account.id, summary: `${account.name} reset their password by email link; all sessions signed out`, severity: "warning" });
      }));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[reset-password]", error);
    return NextResponse.json({ error: "Password reset is unavailable right now." }, { status: 503 });
  }
}
