import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { PageHeader } from "@/components/erp/page-header";
import { COUNTRIES, CURRENCIES, NIGERIAN_STATES } from "@/lib/saas/registration";
import { onboardingStatus } from "@/lib/saas/onboarding";
import { pageData } from "@/lib/session";

import { BusinessProfileForm, ResendVerification } from "./onboarding-forms";

export const metadata = { title: "Setup checklist" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return pageData("settings.manage", "/onboarding", async (actor) => {
    const { welcome } = await searchParams;
    const status = await onboardingStatus(actor);
    const percent = Math.round((status.completed / status.total) * 100);
    const trialDays = status.subscription?.trialEndsAt ? Math.max(0, Math.ceil((Date.parse(status.subscription.trialEndsAt) - Date.now()) / 86_400_000)) : null;

    return (
      <DashboardShell>
        <div className="mx-auto max-w-4xl space-y-6">
          <PageHeader title={welcome ? `Welcome to ${status.profile.businessName}` : "Setup checklist"} description="Finish these steps at your own pace. Everything you add is kept as you go." />
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-700">{status.completed} of {status.total} steps done</p>
              {status.subscription ? (
                <p className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">
                  {status.subscription.planName} · {status.subscription.status === "TRIAL" ? `free trial, ${trialDays} day${trialDays === 1 ? "" : "s"} left` : status.subscription.status.toLowerCase()}
                </p>
              ) : null}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-green-600" style={{ width: `${percent}%` }} /></div>
            <ol className="mt-5 divide-y divide-slate-100">
              {status.steps.map((step) => (
                <li key={step.key} className="flex items-start gap-3 py-3" data-step={step.key} data-done={step.done}>
                  {step.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />}
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${step.done ? "text-slate-500" : "text-slate-900"}`}>{step.title}{step.optional ? <span className="ml-2 text-xs font-normal text-slate-400">optional</span> : null}</p>
                    <p className="text-sm text-slate-500">{step.detail}</p>
                    {step.key === "verify-email" && !step.done ? <ResendVerification /> : null}
                  </div>
                  {step.href && !step.done ? <Link href={step.href} className="shrink-0 rounded-lg border border-green-600 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50">Open</Link> : null}
                </li>
              ))}
            </ol>
          </section>

          <section id="business-profile" className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-900">Business profile</h2>
            <p className="text-sm text-slate-500">Shown on receipts and reports, and used by Web365 to contact you.</p>
            <BusinessProfileForm initial={status.profile} countries={Object.entries(COUNTRIES).map(([code, name]) => ({ code, name }))} currencies={[...CURRENCIES]} states={[...NIGERIAN_STATES]} />
          </section>
        </div>
      </DashboardShell>
    );
  });
}
