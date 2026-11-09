import { currentTenant } from "@/lib/db/database";
import { users } from "@/lib/data";
import { DomainError } from "@/lib/erp/services";
import { sendVerificationEmail } from "@/lib/saas/account-email";
import { guarded } from "@/lib/session";

/** Signed-in user: send (again) the link that confirms their email address. */
export async function POST() {
  return guarded("dashboard.view", async (actor) => {
    const account = users.find((row) => row.id === actor.id);
    if (!account) throw new DomainError("Account not found.", 404);
    if (account.emailVerifiedAt) throw new DomainError("Your email address is already confirmed.");
    const result = await sendVerificationEmail(account, currentTenant()?.name);
    if (result.status !== "SENT") throw new DomainError("Email could not be sent right now. Ask Web365 support to check email delivery.", 503);
    return { ok: true, sentTo: account.email };
  });
}
