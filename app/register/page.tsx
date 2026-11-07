import { connection } from "next/server";

import { AuthCard } from "@/components/auth-card";
import { COUNTRIES, CURRENCIES, NIGERIAN_STATES, publicPlans } from "@/lib/saas/registration";

import { RegisterForm } from "./register-form";

export const metadata = { title: "Register your pharmacy" };

export default async function RegisterPage() {
  await connection();
  const plans = await publicPlans();
  return (
    <AuthCard wide title="Register your pharmacy" subtitle="Set up your pharmacy, its first outlet and your Super Admin account. You can add the rest step by step.">
      <RegisterForm plans={plans} countries={Object.entries(COUNTRIES).map(([code, name]) => ({ code, name }))} currencies={[...CURRENCIES]} states={[...NIGERIAN_STATES]} />
    </AuthCard>
  );
}
