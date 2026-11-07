import Link from "next/link";
import { connection } from "next/server";

import { AuthCard, Notice } from "@/components/auth-card";
import { tokenIsValid } from "@/lib/saas/auth-tokens";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  const valid = value ? await tokenIsValid(value, "reset_password") : false;
  return (
    <AuthCard title="Choose a new password" subtitle={valid ? "You will be signed out on every device and can then sign in with the new password." : undefined}>
      {valid ? (
        <ResetPasswordForm token={value} />
      ) : (
        <div className="space-y-4">
          <Notice tone="error">This reset link is invalid, already used, or expired.</Notice>
          <Link href="/forgot-password" className="block text-center font-medium text-green-700 hover:underline">Send a new link</Link>
        </div>
      )}
    </AuthCard>
  );
}
