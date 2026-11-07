"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";
import type { TenantProfile } from "@/lib/saas/onboarding";

export function ResendVerification() {
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    const response = await fetch("/api/account/verify-email", { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { sentTo?: string; error?: string };
    setBusy(false);
    setMessage(response.ok ? { tone: "success", text: `A new link was sent to ${body.sentTo}.` } : { tone: "error", text: body.error ?? "Could not send the email." });
  }
  return (
    <div className="mt-2 space-y-2">
      <button type="button" onClick={() => void send()} disabled={busy} className="text-sm font-medium text-green-700 hover:underline disabled:opacity-60">{busy ? "Sending…" : "Send the link again"}</button>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}

type Props = { initial: TenantProfile; countries: { code: string; name: string }[]; currencies: string[]; states: string[] };

export function BusinessProfileForm({ initial, countries, currencies, states }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<TenantProfile>(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timeZones = useMemo(() => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [form.timeZone]), [form.timeZone]);
  const set = (key: keyof TenantProfile) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/tenant/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) return setMessage({ tone: "error", text: body.error ?? "Could not save." });
    setMessage({ tone: "success", text: "Business profile saved." });
    router.refresh();
  }

  const nigeria = form.country === "NG";
  return (
    <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Pharmacy / business name"><input required className={inputClass} value={form.businessName} onChange={set("businessName")} /></Field></div>
      <Field label="Business email"><input required type="email" className={inputClass} value={form.businessEmail} onChange={set("businessEmail")} /></Field>
      <Field label="Business phone"><input required type="tel" className={inputClass} value={form.businessPhone} onChange={set("businessPhone")} /></Field>
      <div className="sm:col-span-2"><Field label="Address"><input required className={inputClass} value={form.address} onChange={set("address")} /></Field></div>
      <Field label="Country">
        <select className={inputClass} value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value as TenantProfile["country"], state: event.target.value === "NG" ? "Lagos" : "" }))}>
          {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
        </select>
      </Field>
      <Field label={nigeria ? "State" : "State / region"}>
        {nigeria ? <select className={inputClass} value={form.state} onChange={set("state")}>{states.map((state) => <option key={state}>{state}</option>)}</select> : <input required className={inputClass} value={form.state} onChange={set("state")} />}
      </Field>
      <Field label="Currency"><select className={inputClass} value={form.currency} onChange={set("currency")}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
      <Field label="Time zone"><select className={inputClass} value={form.timeZone} onChange={set("timeZone")}>{timeZones.map((zone) => <option key={zone}>{zone}</option>)}</select></Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">{busy ? "Saving…" : "Save profile"}</button>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </div>
    </form>
  );
}
