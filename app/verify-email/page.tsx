import { connection } from "next/server";

import { AuthCard, Notice } from "@/components/auth-card";
import { tokenIsValid } from "@/lib/saas/auth-tokens";

import { ConfirmEmailButton } from "./confirm-email-button";

export const metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  const valid = value ? await tokenIsValid(value, "verify_email") : false;
  return (
    <AuthCard title="Confirm your email address">
      {valid ? <ConfirmEmailButton token={value} /> : <Notice tone="error">This confirmation link is invalid, already used, or expired. Sign in and send a new one from the setup checklist.</Notice>}
    </AuthCard>
  );
}
