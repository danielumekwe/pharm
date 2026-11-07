"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Secret = { set: boolean; hint: string | null };
type Setting = {
  value: { enabled: boolean; mode: "test" | "live"; testPublicKey: string; livePublicKey: string; currency: string };
  secrets: { testSecretKey: Secret; liveSecretKey: Secret };
  updatedAt: string | null;
};

/** Secret keys are write-only: the page shows whether one is saved and its last four characters, never the key. */
export function PaystackSettingsForm({ setting }: { setting: Setting }) {
  const router = useRouter();
  const [value, setValue] = useState(setting.value);
  const [secrets, setSecrets] = useState<{ testSecretKey: string; liveSecretKey: string }>({ testSecretKey: "", liveSecretKey: "" });
  const [clear, setClear] = useState<{ testSecretKey: boolean; liveSecretKey: boolean }>({ testSecretKey: false, liveSecretKey: false });
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (value.mode === "live" && value.enabled && !window.confirm("Live mode charges real cards. Continue?")) return;
    setBusy(true);
    setMessage(null);
    const body = {
      value,
      secrets: Object.fromEntries((["testSecretKey", "liveSecretKey"] as const).map((name) => [name, clear[name] ? null : secrets[name]])),
    };
    const response = await fetch("/api/platform/settings/payments.paystack", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setSecrets({ testSecretKey: "", liveSecretKey: "" }); // the typed keys are not kept in the page
    setClear({ testSecretKey: false, liveSecretKey: false });
    if (!response.ok) return setMessage({ tone: "error", text: result.error ?? "Could not save." });
    setMessage({ tone: "success", text: "Saved." });
    router.refresh();
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/platform/settings/payments.paystack/test", { method: "POST" });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
    setBusy(false);
    setMessage({ tone: result.ok ? "success" : "error", text: result.detail ?? result.error ?? "Test failed." });
    router.refresh();
  }

  const secretField = (name: "testSecretKey" | "liveSecretKey", label: string) => {
    const saved = setting.secrets[name];
    return (
      <Field label={label} hint={saved.set ? `Saved (${saved.hint}). Leave blank to keep it.` : "Not saved."}>
        <input type="password" autoComplete="new-password" spellCheck={false} className={inputClass} value={secrets[name]} placeholder={saved.set ? saved.hint ?? "" : name === "liveSecretKey" ? "sk_live_…" : "sk_test_…"} onChange={(event) => setSecrets({ ...secrets, [name]: event.target.value })} />
        {saved.set ? <label className="mt-1 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={clear[name]} onChange={(event) => setClear({ ...clear, [name]: event.target.checked })} /> Remove the saved key</label> : null}
      </Field>
    );
  };

  return (
    <form onSubmit={save} className="space-y-4" data-paystack-form>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={value.enabled} onChange={(event) => setValue({ ...value, enabled: event.target.checked })} /> Use these settings for payments</label>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(["test", "live"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setValue({ ...value, mode })} className={`rounded-md px-3 py-1 font-medium ${value.mode === mode ? (mode === "live" ? "bg-rose-600 text-white" : "bg-white text-green-800 shadow-sm") : "text-slate-600"}`}>{mode === "test" ? "Test mode" : "Live mode"}</button>
          ))}
        </div>
        <Field label="Currency"><select className={inputClass} value={value.currency} onChange={(event) => setValue({ ...value, currency: event.target.value })}>{["NGN", "GHS", "KES", "ZAR", "USD"].map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Test public key"><input className={inputClass} spellCheck={false} value={value.testPublicKey} placeholder="pk_test_…" onChange={(event) => setValue({ ...value, testPublicKey: event.target.value.trim() })} /></Field>
        {secretField("testSecretKey", "Test secret key")}
        <Field label="Live public key"><input className={inputClass} spellCheck={false} value={value.livePublicKey} placeholder="pk_live_…" onChange={(event) => setValue({ ...value, livePublicKey: event.target.value.trim() })} /></Field>
        {secretField("liveSecretKey", "Live secret key")}
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        <button type="button" disabled={busy} onClick={() => void test()} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">Test connection</button>
      </div>
      <p className="text-xs text-slate-500">Keys are encrypted on the server and never sent back to this page. Every change is recorded in the history below and in the platform audit log.</p>
    </form>
  );
}
