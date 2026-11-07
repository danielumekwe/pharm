import { AuthCard } from "@/components/auth-card";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your email and we will send you a link to choose a new one.">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
