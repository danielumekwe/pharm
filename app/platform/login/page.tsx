import { AuthCard } from "@/components/auth-card";

import { PlatformLoginForm } from "./platform-login-form";

export const metadata = { title: "Web365 platform sign-in" };

export default function PlatformLoginPage() {
  return (
    <AuthCard title="Web365 platform" subtitle="For Web365 staff only. Pharmacy staff sign in on the main page.">
      <PlatformLoginForm />
    </AuthCard>
  );
}
