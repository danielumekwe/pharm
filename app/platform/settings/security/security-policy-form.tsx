"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Policy = { requireTwoFactor: boolean; sessionHours: number; idleMinutes: number; maxFailedAttempts: number; lockoutMinutes: number; ipAllowlist: string[] };

export function SecurityPolicyForm({ value: initial, address }: { value: Policy; address: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [allowlist, setAllowlist] = useState(initial.ipAllowlist.join("\n"));
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const number = (key: keyof Policy) => (event: React.ChangeEvent<HTMLInputElement>) => setValue({ ...value, [key]: Number(event.target.value) });
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const ipAllowlist = allowlist.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
    if (value.requireTwoFactor && !initial.requireTwoFactor && !window.confirm("Everyone without two-factor sign-in will have to set it up before they can continue. Go ahead?")) return;
    const response = await fetch("/api/platform/settings/security.policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: { ...value, ipAllowlist } }) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return setMessage({ tone: "error", text: result.error ?? "Could not save." });
    setMessage({ tone: "success", text: "Saved." });
    router.refresh();
  }
  return (
    <form onSubmit={save} className="space-y-4" data-security-policy>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={value.requireTwoFactor} onChange={(event) => setValue({ ...value, requireTwoFactor: event.target.checked })} /> Require two-factor sign-in for all platform staff</label>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Session length (hours)"><input type="number" min={1} max={24} className={inputClass} value={value.sessionHours} onChange={number("sessionHours")} /></Field>
        <Field label="Sign out after inactivity (minutes)"><input type="number" min={5} max={480} className={inputClass} value={value.idleMinutes} onChange={number("idleMinutes")} /></Field>
        <Field label="Failed attempts before lockout"><input type="number" min={3} max={20} className={inputClass} value={value.maxFailedAttempts} onChange={number("maxFailedAttempts")} /></Field>
        <Field label="Lockout (minutes)"><input type="number" min={5} max={1440} className={inputClass} value={value.lockoutMinutes} onChange={number("lockoutMinutes")} /></Field>
      </div>
      <Field label="Allowed addresses for the Control Centre (optional)" hint={`One IP address or range per line, e.g. 102.89.12.4 or 102.89.0.0/16. Empty: any address. Your address now: ${address}. Pharmacies are not affected.`}>
        <textarea rows={3} className={`${inputClass} h-auto py-2 font-mono text-sm`} value={allowlist} onChange={(event) => setAllowlist(event.target.value)} />
      </Field>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <button type="submit" className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800">Save policy</button>
    </form>
  );
}
