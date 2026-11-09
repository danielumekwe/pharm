import { NextResponse } from "next/server";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { isCaptchaError, verifyRecaptcha } from "@/lib/recaptcha";
import { sendPasswordResetEmail } from "@/lib/saas/account-email";
import { clientAddress } from "@/lib/saas/rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(160), recaptchaToken: z.string().max(4000).optional() });
const ANSWER = { ok: true, message: "If an account uses that email, a reset link is on its way. It expires in 60 minutes." };

/**
 * Public: emails a password reset link. The answer is the same whether or not the email has an account, so
 * the form cannot be used to find out who is registered.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const { email } = parsed.data;
  try {
    const address = await clientAddress();
    await verifyRecaptcha(parsed.data.recaptchaToken, "forgot_password", address);
    const [account] = await platformQuery<Array<{ id: string; name: string; email: string }>>((query) =>
      query(
        `SELECT u.id, u.name, u.email FROM users u
         WHERE lower(u.email) = $1 AND EXISTS (
           SELECT 1 FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
           WHERE m.user_id = u.id AND m.status IN ('ACTIVE', 'SUSPENDED') AND t.status = 'ACTIVE')`,
        [email],
      ),
    );
    if (account) await sendPasswordResetEmail(account);
    return NextResponse.json(ANSWER);
  } catch (error) {
    if (isCaptchaError(error)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[forgot-password]", error);
    return NextResponse.json(ANSWER);
  }
}
