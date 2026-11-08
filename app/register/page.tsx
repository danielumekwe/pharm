import Link from "next/link";
import { connection } from "next/server";

import { AuthCard } from "@/components/auth-card";
import { systemConfig } from "@/lib/platform/system";
import { COUNTRIES, CURRENCIES, NIGERIAN_STATES, publicPlans } from "@/lib/saas/registration";

import { RegisterForm } from "./register-form";

export const metadata = { title: "Register your pharmacy" };

export default async function RegisterPage() {
  await connection();
  const [plans, config] = await Promise.all([publicPlans(), systemConfig()]);
  if (!config.registrationOpen || config.maintenance) {
    return (
      <AuthCard title="Register your pharmacy" subtitle={config.maintenance ? config.maintenanceMessage || "Pharmacy ERP is being updated. Please try again shortly." : "New registrations are closed at the moment. Contact Web365 to open an account."}>
        <p className="text-sm text-slate-600" data-registration-closed>Already registered? <Link href="/login" className="font-semibold text-green-800 hover:underline">Sign in</Link>.</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard wide title="Register your pharmacy" subtitle="Set up your pharmacy, its first outlet and your Super Admin account. You can add the rest step by step.">
      <RegisterForm plans={plans} countries={Object.entries(COUNTRIES).map(([code, name]) => ({ code, name }))} currencies={[...CURRENCIES]} states={[...NIGERIAN_STATES]} />
    </AuthCard>
  );
}
