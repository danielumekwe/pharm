// Platform emails to people: account emails (confirm, reset, welcome, join), registration and trial notices,
// billing and suspension notices. All use the editable templates (lib/notify/templates.ts), are logged, and
// are retried by the platform email queue if delivery fails. Links point at APP_URL (or NEXTAUTH_URL).
import { platformQuery } from "@/lib/db/database";
import { sendEmail, type DeliveryResult, type EmailMeta } from "@/lib/notify/email";
import { renderEmail, type TemplateKey } from "@/lib/notify/templates";
import { readPlatformSetting } from "@/lib/platform/settings";
import { issueToken, TOKEN_LIFETIME_MS } from "@/lib/saas/auth-tokens";

export function appUrl() {
  const base = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (!base) throw new Error("Set APP_URL so account emails can link back to the app.");
  return base.replace(/\/$/, "");
}

type Account = { id: string; name: string; email: string };

async function send(to: string, template: TemplateKey, values: Record<string, string | number | null | undefined>, meta: Omit<EmailMeta, "template">): Promise<DeliveryResult> {
  const email = await renderEmail(template, values);
  return sendEmail({ to, ...email }, { ...meta, template, retryable: true });
}

export async function sendVerificationEmail(account: Account, pharmacy?: string): Promise<DeliveryResult> {
  const token = await issueToken(account.id, "verify_email");
  return send(account.email, "verify_email", { name: account.name, pharmacy: pharmacy ?? "your pharmacy", link: `${appUrl()}/verify-email?token=${token}`, hours: TOKEN_LIFETIME_MS.verify_email / 3_600_000 }, { category: "account" });
}

export async function sendPasswordResetEmail(account: Account): Promise<DeliveryResult> {
  const token = await issueToken(account.id, "reset_password");
  return send(account.email, "password_reset", { name: account.name, link: `${appUrl()}/reset-password?token=${token}`, minutes: TOKEN_LIFETIME_MS.reset_password / 60_000 }, { category: "account" });
}

/** For accounts Web365 creates on a pharmacy's behalf: a 48-hour link to choose the first password. */
export async function sendAccountSetupEmail(account: Account, pharmacy: string): Promise<DeliveryResult> {
  const token = await issueToken(account.id, "reset_password", { lifetimeMs: 48 * 3_600_000 });
  return send(account.email, "welcome", { name: account.name, pharmacy, link: `${appUrl()}/reset-password?token=${token}`, hours: 48 }, { category: "account" });
}

/** For people who already have an account: an invitation to also work for another pharmacy. */
export async function sendJoinPharmacyEmail(account: Account, tenantId: string, pharmacy: string, role: string, invitedBy: string): Promise<DeliveryResult> {
  const token = await issueToken(account.id, "join_pharmacy", { tenantId });
  return send(account.email, "join_pharmacy", { name: account.name, pharmacy, role, invited_by: invitedBy, link: `${appUrl()}/join?token=${token}`, days: TOKEN_LIFETIME_MS.join_pharmacy / 86_400_000 }, { category: "account", tenantId });
}

/** After self-registration: "trial started" to the owner, and a notice to Web365's notification address (if set). */
export async function sendRegistrationEmails(input: { tenantId: string; owner: Account; pharmacy: string; plan: string; trialEnd: Date; state: string; country: string }) {
  const day = input.trialEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  await send(input.owner.email, "trial_started", { name: input.owner.name, pharmacy: input.pharmacy, plan: input.plan, trial_end: day, link: `${appUrl()}/subscription` }, { category: "account", tenantId: input.tenantId });
  const settings = await readPlatformSetting("email.delivery").catch(() => null);
  const notify = settings?.value.notifyEmail;
  if (notify) await send(notify, "pharmacy_registered", { pharmacy: input.pharmacy, owner_name: input.owner.name, owner_email: input.owner.email, plan: input.plan, state: input.state, country: input.country }, { category: "platform", tenantId: input.tenantId });
}

/** Active Pharmacy Super Admins of a pharmacy (who receive billing and account notices). */
export async function pharmacyOwners(tenantId: string) {
  return platformQuery<Array<{ name: string; email: string; pharmacy: string }>>((query) =>
    query(
      `SELECT u.name, u.email, t.name AS pharmacy FROM tenant_memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
       WHERE m.tenant_id = $1 AND m.role = 'SUPER_ADMIN' AND m.status = 'ACTIVE'`,
      [tenantId],
    ),
  );
}

/** Sends a template to every active Pharmacy Super Admin of the pharmacy. */
export async function notifyPharmacyOwners(tenantId: string, template: TemplateKey, values: Record<string, string | number | null | undefined>, category: "billing" | "platform") {
  for (const owner of await pharmacyOwners(tenantId)) {
    await send(owner.email, template, { name: owner.name, pharmacy: owner.pharmacy, ...values }, { category, tenantId });
  }
}
