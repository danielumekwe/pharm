// Account emails: confirm an email address, reset a password. Links point at APP_URL (or NEXTAUTH_URL).
import { sendEmail, type DeliveryResult } from "@/lib/notify/email";
import { issueToken, TOKEN_LIFETIME_MS } from "@/lib/saas/auth-tokens";

function appUrl() {
  const base = process.env.APP_URL || process.env.NEXTAUTH_URL;
  if (!base) throw new Error("Set APP_URL so account emails can link back to the app.");
  return base.replace(/\/$/, "");
}

type Account = { id: string; name: string; email: string };

export async function sendVerificationEmail(account: Account, pharmacy?: string): Promise<DeliveryResult> {
  const token = await issueToken(account.id, "verify_email");
  const link = `${appUrl()}/verify-email?token=${token}`;
  const hours = TOKEN_LIFETIME_MS.verify_email / 3_600_000;
  return sendEmail({
    to: account.email,
    subject: "Confirm your email address",
    text: [
      `Hello ${account.name},`,
      "",
      `Please confirm this email address for your Pharmacy ERP account${pharmacy ? ` at ${pharmacy}` : ""}:`,
      link,
      "",
      `The link works once and expires in ${hours} hours. If you did not create this account, you can ignore this email.`,
    ].join("\n"),
  });
}

export async function sendPasswordResetEmail(account: Account): Promise<DeliveryResult> {
  const token = await issueToken(account.id, "reset_password");
  const link = `${appUrl()}/reset-password?token=${token}`;
  const minutes = TOKEN_LIFETIME_MS.reset_password / 60_000;
  return sendEmail({
    to: account.email,
    subject: "Reset your password",
    text: [
      `Hello ${account.name},`,
      "",
      "We received a request to reset your Pharmacy ERP password. Choose a new one here:",
      link,
      "",
      `The link works once and expires in ${minutes} minutes. Resetting signs you out on every device.`,
      "If you did not ask for this, ignore this email; your password stays the same.",
    ].join("\n"),
  });
}

/** For accounts Web365 creates on a pharmacy's behalf: a 48-hour link to choose the first password. */
export async function sendAccountSetupEmail(account: Account, pharmacy: string): Promise<DeliveryResult> {
  const token = await issueToken(account.id, "reset_password", { lifetimeMs: 48 * 3_600_000 });
  const link = `${appUrl()}/reset-password?token=${token}`;
  return sendEmail({
    to: account.email,
    subject: `Your ${pharmacy} account is ready`,
    text: [
      `Hello ${account.name},`,
      "",
      `Web365 has set up ${pharmacy} on Pharmacy ERP with you as its Super Admin. Choose your password to sign in:`,
      link,
      "",
      "The link works once and expires in 48 hours.",
    ].join("\n"),
  });
}

/** For people who already have an account: an invitation to also work for another pharmacy. */
export async function sendJoinPharmacyEmail(account: Account, tenantId: string, pharmacy: string, role: string, invitedBy: string): Promise<DeliveryResult> {
  const token = await issueToken(account.id, "join_pharmacy", { tenantId });
  const link = `${appUrl()}/join?token=${token}`;
  const days = TOKEN_LIFETIME_MS.join_pharmacy / 86_400_000;
  return sendEmail({
    to: account.email,
    subject: `${invitedBy} invited you to ${pharmacy}`,
    text: [
      `Hello ${account.name},`,
      "",
      `${invitedBy} has added you to ${pharmacy} as ${role}. You keep your existing account and password.`,
      `To accept, open this link (it works once and expires in ${days} days):`,
      link,
      "",
      "Until you accept, you will not see this pharmacy when you sign in. If you were not expecting this, ignore the email.",
    ].join("\n"),
  });
}
