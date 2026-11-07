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
