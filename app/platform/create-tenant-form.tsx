"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Props = { plans: { id: string; name: string }[]; countries: { code: string; name: string }[]; currencies: string[]; states: string[] };

/** Web365 sets up a pharmacy for a customer; the owner receives an email to choose their password. */
export function CreateTenantForm({ plans, countries, currencies, states }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const blank = { businessName: "", businessEmail: "", businessPhone: "", address: "", country: "NG", state: "Lagos", currency: "NGN", timeZone: "Africa/Lagos", ownerName: "", ownerEmail: "", ownerPhone: "", planId: plans[0]?.id ?? "", billingCycle: "MONTHLY" };
  const [form, setForm] = useState(blank);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/platform/tenants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, requestId }) });
    const body = (await response.json().catch(() => ({}))) as { error?: string; setupEmail?: string };
    setBusy(false);
    if (!response.ok) return setMessage({ tone: "error", text: body.error ?? "Could not create the pharmacy." });
    setMessage({ tone: "success", text: `Created. Setup email: ${body.setupEmail?.toLowerCase()}.` });
    setForm(blank);
    setRequestId(crypto.randomUUID());
    router.refresh();
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-4 rounded-xl bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">Create a pharmacy</button>;
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
      <div className="sm:col-span-3 flex items-center justify-between"><h2 className="font-semibold">New pharmacy</h2><button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">Close</button></div>
      <Field label="Pharmacy name"><input required className={inputClass} value={form.businessName} onChange={set("businessName")} /></Field>
      <Field label="Business email"><input required type="email" className={inputClass} value={form.businessEmail} onChange={set("businessEmail")} /></Field>
      <Field label="Business phone"><input required className={inputClass} value={form.businessPhone} onChange={set("businessPhone")} /></Field>
      <div className="sm:col-span-3"><Field label="Address"><input required className={inputClass} value={form.address} onChange={set("address")} /></Field></div>
      <Field label="Country"><select className={inputClass} value={form.country} onChange={set("country")}>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></Field>
      <Field label="State">{form.country === "NG" ? <select className={inputClass} value={form.state} onChange={set("state")}>{states.map((state) => <option key={state}>{state}</option>)}</select> : <input required className={inputClass} value={form.state} onChange={set("state")} />}</Field>
      <Field label="Currency"><select className={inputClass} value={form.currency} onChange={set("currency")}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
      <Field label="Owner name"><input required className={inputClass} value={form.ownerName} onChange={set("ownerName")} /></Field>
      <Field label="Owner email"><input required type="email" className={inputClass} value={form.ownerEmail} onChange={set("ownerEmail")} /></Field>
      <Field label="Owner phone"><input required className={inputClass} value={form.ownerPhone} onChange={set("ownerPhone")} /></Field>
      <Field label="Plan"><select className={inputClass} value={form.planId} onChange={set("planId")}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Field>
      <Field label="Billing"><select className={inputClass} value={form.billingCycle} onChange={set("billingCycle")}><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></select></Field>
      <div className="flex items-end"><button type="submit" disabled={busy} className="h-11 w-full rounded-xl bg-green-700 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">{busy ? "Creating…" : "Create and email the owner"}</button></div>
      {message ? <div className="sm:col-span-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
    </form>
  );
}
