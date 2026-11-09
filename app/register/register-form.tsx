"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { buttonClass, Field, inputClass, Notice } from "@/components/auth-card";
import { preloadRecaptcha, recaptchaToken } from "@/lib/recaptcha-client";
import type { PublicPlan } from "@/lib/saas/registration";

type Props = { plans: PublicPlan[]; countries: { code: string; name: string }[]; currencies: string[]; states: string[] };

function price(plan: PublicPlan, cycle: "MONTHLY" | "ANNUAL") {
  const amount = cycle === "MONTHLY" ? plan.monthlyPrice : plan.annualPrice;
  if (amount === null) return "Price to be announced";
  return `${new Intl.NumberFormat("en-NG", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(amount)} / ${cycle === "MONTHLY" ? "month" : "year"}`;
}

export function RegisterForm({ plans, countries, currencies, states }: Props) {
  const router = useRouter();
  // One key per registration attempt: resubmitting (double click, retry after a timeout) never creates a second pharmacy.
  const [requestId] = useState(() => crypto.randomUUID());
  const timeZones = useMemo(() => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Africa/Lagos"]), []);
  const [form, setForm] = useState({
    businessName: "", businessEmail: "", businessPhone: "", address: "", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos",
    ownerName: "", ownerEmail: "", ownerPhone: "", password: "", confirm: "",
    planId: plans[0]?.id ?? "", billingCycle: "MONTHLY" as "MONTHLY" | "ANNUAL",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => preloadRecaptcha(), []);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (form.password !== form.confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      const response = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, confirm: undefined, requestId, recaptchaToken: await recaptchaToken("register") }) });
      const body = (await response.json().catch(() => ({}))) as { tenantId?: string; error?: string };
      if (!response.ok || !body.tenantId) throw new Error(body.error ?? "Registration failed. Please try again.");
      const result = await signIn("credentials", { identifier: form.ownerEmail, password: form.password, tenantId: body.tenantId, outletId: "HQ", recaptchaToken: (await recaptchaToken("login")) ?? "", redirect: false });
      if (result?.error) {
        router.push("/login?registered=1");
        return;
      }
      router.push("/onboarding?welcome=1");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration failed.");
      setBusy(false);
    }
  }

  const nigeria = form.country === "NG";
  return (
    <form className="space-y-6" onSubmit={submit}>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-green-800">Pharmacy</legend>
        <div className="sm:col-span-2"><Field label="Pharmacy / business name"><input required className={inputClass} value={form.businessName} onChange={set("businessName")} autoComplete="organization" /></Field></div>
        <Field label="Business email"><input required type="email" className={inputClass} value={form.businessEmail} onChange={set("businessEmail")} /></Field>
        <Field label="Business phone"><input required type="tel" className={inputClass} value={form.businessPhone} onChange={set("businessPhone")} placeholder="0803 000 0000" /></Field>
        <div className="sm:col-span-2"><Field label="Business address" hint="Also used for your first outlet."><input required className={inputClass} value={form.address} onChange={set("address")} autoComplete="street-address" /></Field></div>
        <Field label="Country">
          <select className={inputClass} value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value, state: event.target.value === "NG" ? "Lagos" : "" }))}>
            {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </Field>
        <Field label={nigeria ? "State" : "State / region"}>
          {nigeria ? (
            <select className={inputClass} value={form.state} onChange={set("state")}>{states.map((state) => <option key={state}>{state}</option>)}</select>
          ) : (
            <input required className={inputClass} value={form.state} onChange={set("state")} />
          )}
        </Field>
        <Field label="Currency"><select className={inputClass} value={form.currency} onChange={set("currency")}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
        <Field label="Time zone"><select className={inputClass} value={form.timeZone} onChange={set("timeZone")}>{timeZones.map((zone) => <option key={zone}>{zone}</option>)}</select></Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-green-800">Owner (Super Admin)</legend>
        <div className="sm:col-span-2"><Field label="Full name"><input required className={inputClass} value={form.ownerName} onChange={set("ownerName")} autoComplete="name" /></Field></div>
        <Field label="Email" hint="You sign in with this; we send a confirmation link."><input required type="email" className={inputClass} value={form.ownerEmail} onChange={set("ownerEmail")} autoComplete="email" /></Field>
        <Field label="Phone"><input required type="tel" className={inputClass} value={form.ownerPhone} onChange={set("ownerPhone")} autoComplete="tel" /></Field>
        <Field label="Password" hint="At least 8 characters, with letters and a number."><input required type="password" minLength={8} className={inputClass} value={form.password} onChange={set("password")} autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input required type="password" className={inputClass} value={form.confirm} onChange={set("confirm")} autoComplete="new-password" /></Field>
      </fieldset>

      <fieldset>
        <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold uppercase tracking-[0.14em] text-green-800">
          Plan
          <span className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs normal-case tracking-normal">
            {(["MONTHLY", "ANNUAL"] as const).map((cycle) => (
              <button key={cycle} type="button" onClick={() => setForm((current) => ({ ...current, billingCycle: cycle }))} className={`rounded-md px-2.5 py-1 font-medium ${form.billingCycle === cycle ? "bg-white text-green-800 shadow-sm" : "text-slate-600"}`}>
                {cycle === "MONTHLY" ? "Monthly" : "Annual"}
              </button>
            ))}
          </span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Plan">
          {plans.map((plan) => {
            const active = plan.id === form.planId;
            return (
              <button key={plan.id} type="button" role="radio" aria-checked={active} onClick={() => setForm((current) => ({ ...current, planId: plan.id }))}
                className={`rounded-2xl border p-4 text-left transition ${active ? "border-green-700 bg-green-50 ring-2 ring-green-700/20" : "border-slate-200 hover:border-green-600"}`}>
                <span className="block text-base font-semibold text-slate-900">{plan.name}</span>
                <span className="mt-0.5 block text-sm font-medium text-green-800">{price(plan, form.billingCycle)}</span>
                <span className="mt-2 block text-xs leading-relaxed text-slate-600">{plan.description}</span>
                <span className="mt-2 block text-xs font-medium text-slate-700">
                  {plan.maxOutlets === null ? "Outlet limit not set" : `${plan.maxOutlets} outlet${plan.maxOutlets === 1 ? "" : "s"}`}
                  {" · "}
                  {plan.maxStaffAccounts === null ? "Staff limit not set" : `${plan.maxStaffAccounts} staff accounts`}
                </span>
                {plan.trialDays ? <span className="mt-2 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">{plan.trialDays}-day free trial</span> : null}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">No payment is taken now. Your free trial starts today; billing is set up later from your account page.</p>
      </fieldset>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <button type="submit" disabled={busy || !form.planId} className={buttonClass}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {busy ? "Setting up your pharmacy…" : "Create my pharmacy"}
      </button>
      <p className="text-center text-sm text-slate-600">Already registered? <Link href="/login" className="font-medium text-green-700 hover:underline">Sign in</Link></p>
    </form>
  );
}
