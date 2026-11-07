"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Secret = { set: boolean; hint: string | null };
type Value = {
  enabled: boolean;
  provider: "zeptomail_api" | "zeptomail_smtp" | "smtp";
  zeptoRegion: string;
  host: string;
  port: number;
  encryption: "starttls" | "ssl" | "none";
  username: string;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  notifyEmail: string;
};
type Setting = { value: Value; secrets: { apiToken: Secret; password: Secret }; updatedAt: string | null };
type Message = { tone: "success" | "error"; text: string } | null;

const REGIONS = [["com", "Global (zeptomail.com)"], ["eu", "Europe (.eu)"], ["in", "India (.in)"], ["com.au", "Australia (.com.au)"], ["jp", "Japan (.jp)"], ["ca", "Canada (.ca)"], ["sa", "Saudi Arabia (.sa)"]];

const button = "rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60";

/** Credentials are write-only: the page shows whether one is saved and its last four characters, never the value. */
export function EmailSettingsForm({ setting }: { setting: Setting }) {
  const router = useRouter();
  const [value, setValue] = useState(setting.value);
  const [secrets, setSecrets] = useState({ apiToken: "", password: "" });
  const [clear, setClear] = useState({ apiToken: false, password: false });
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Value>) => setValue({ ...value, ...patch });

  function chooseProvider(provider: Value["provider"]) {
    if (provider === "zeptomail_smtp") set({ provider, host: `smtp.zeptomail.${value.zeptoRegion}`, port: 587, encryption: "starttls", username: value.username || "emailapikey" });
    else set({ provider });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const body = { value, secrets: Object.fromEntries((["apiToken", "password"] as const).map((name) => [name, clear[name] ? null : secrets[name]])) };
    const response = await fetch("/api/platform/settings/email.delivery", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setSecrets({ apiToken: "", password: "" }); // typed credentials are not kept in the page
    setClear({ apiToken: false, password: false });
    if (!response.ok) return setMessage({ tone: "error", text: result.error ?? "Could not save." });
    setMessage({ tone: "success", text: "Saved." });
    router.refresh();
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/platform/settings/email.delivery/test", { method: "POST" });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
    setBusy(false);
    setMessage({ tone: result.ok ? "success" : "error", text: result.detail ?? result.error ?? "Test failed." });
    router.refresh();
  }

  const secretField = (name: "apiToken" | "password", label: string, placeholder: string) => {
    const saved = setting.secrets[name];
    return (
      <Field label={label} hint={saved.set ? `Saved (${saved.hint}). Leave blank to keep it.` : "Not saved."}>
        <input type="password" autoComplete="new-password" spellCheck={false} className={inputClass} value={secrets[name]} placeholder={saved.set ? saved.hint ?? "" : placeholder} onChange={(event) => setSecrets({ ...secrets, [name]: event.target.value })} />
        {saved.set ? <label className="mt-1 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={clear[name]} onChange={(event) => setClear({ ...clear, [name]: event.target.checked })} /> Remove the saved value</label> : null}
      </Field>
    );
  };

  const smtp = value.provider !== "zeptomail_api";
  return (
    <form onSubmit={save} className="space-y-4" data-email-form>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} /> Send email with these settings</label>
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {(["zeptomail_api", "zeptomail_smtp", "smtp"] as const).map((provider) => (
          <button key={provider} type="button" onClick={() => chooseProvider(provider)} className={`rounded-md px-3 py-1 font-medium ${value.provider === provider ? "bg-white text-green-800 shadow-sm" : "text-slate-600"}`}>
            {provider === "zeptomail_api" ? "ZeptoMail API" : provider === "zeptomail_smtp" ? "ZeptoMail SMTP" : "Other SMTP"}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {value.provider !== "smtp" ? (
          <Field label="ZeptoMail region"><select className={inputClass} value={value.zeptoRegion} onChange={(event) => set({ zeptoRegion: event.target.value, ...(value.provider === "zeptomail_smtp" ? { host: `smtp.zeptomail.${event.target.value}` } : {}) })}>{REGIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></Field>
        ) : null}
        {value.provider === "zeptomail_api" ? secretField("apiToken", "Send Mail token", "Zoho-enczapikey …") : null}
        {smtp ? (
          <>
            <Field label="SMTP host"><input className={inputClass} spellCheck={false} value={value.host} placeholder="smtp.example.com" onChange={(event) => set({ host: event.target.value.trim() })} /></Field>
            <Field label="Port"><input type="number" className={inputClass} value={value.port} onChange={(event) => set({ port: Number(event.target.value) })} /></Field>
            <Field label="Encryption"><select className={inputClass} value={value.encryption} onChange={(event) => set({ encryption: event.target.value as Value["encryption"] })}><option value="starttls">STARTTLS (usually port 587)</option><option value="ssl">SSL/TLS (usually port 465)</option><option value="none">None (not recommended)</option></select></Field>
            <Field label="Username" hint={value.provider === "zeptomail_smtp" ? "ZeptoMail uses \"emailapikey\"." : undefined}><input className={inputClass} spellCheck={false} autoComplete="off" value={value.username} onChange={(event) => set({ username: event.target.value.trim() })} /></Field>
            {secretField("password", value.provider === "zeptomail_smtp" ? "Password (the Send Mail token)" : "Password", "••••••••")}
          </>
        ) : null}
        <Field label="Sender name"><input className={inputClass} value={value.senderName} onChange={(event) => set({ senderName: event.target.value })} /></Field>
        <Field label="Sender email" hint="Must be on a domain verified with your provider."><input type="email" className={inputClass} value={value.senderEmail} placeholder="support@example.com" onChange={(event) => set({ senderEmail: event.target.value.trim() })} /></Field>
        <Field label="Reply-to (optional)"><input type="email" className={inputClass} value={value.replyTo} onChange={(event) => set({ replyTo: event.target.value.trim() })} /></Field>
        <Field label="New-pharmacy notices to (optional)" hint="Web365 gets an email here when a pharmacy registers."><input type="email" className={inputClass} value={value.notifyEmail} onChange={(event) => set({ notifyEmail: event.target.value.trim() })} /></Field>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${button} bg-green-700 text-white hover:bg-green-800`}>{busy ? "Working…" : "Save"}</button>
        <button type="button" disabled={busy} onClick={() => void test()} className={`${button} border border-slate-300 hover:bg-slate-50`}>Test connection</button>
      </div>
      <p className="text-xs text-slate-500">Credentials are encrypted on the server and never sent back to this page. The connection test checks the saved settings; it does not send an email (use “Send a test email” for that).</p>
    </form>
  );
}

export function TestEmail({ defaultTo }: { defaultTo: string }) {
  const router = useRouter();
  const [to, setTo] = useState(defaultTo);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/platform/email/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to }) });
    const result = (await response.json().catch(() => ({}))) as { status?: string; detail?: string; error?: string };
    setBusy(false);
    setMessage({ tone: result.status === "SENT" ? "success" : "error", text: result.status === "SENT" ? `Accepted for delivery to ${to}. Check the inbox (and spam folder).` : result.detail ?? result.error ?? "Not sent." });
    router.refresh();
  }
  return (
    <form onSubmit={send} className="space-y-2 text-sm" data-test-email>
      <h2 className="font-semibold">Send a test email</h2>
      <input type="email" required className={inputClass} value={to} onChange={(event) => setTo(event.target.value)} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <button type="submit" disabled={busy} className={`${button} border border-slate-300 hover:bg-slate-50`}>{busy ? "Sending…" : "Send test email"}</button>
    </form>
  );
}

type Delivery = { id: string; created_at: string; category: string; template: string | null; pharmacy: string | null; recipient: string; subject: string; status: string; provider: string | null; attempts: number; next_attempt_at: string | null; last_error: string | null; retryable: boolean };

export function EmailDeliveries({ rows }: { rows: Delivery[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const time = (value: string | null) => (value ? value.replace("T", " ").slice(0, 16) : "—");
  async function retry(id: string) {
    setBusy(id);
    setError(null);
    const response = await fetch(`/api/platform/email/deliveries/${encodeURIComponent(id)}/retry`, { method: "POST" });
    const result = (await response.json().catch(() => ({}))) as { status?: string; detail?: string; error?: string };
    setBusy(null);
    if (!response.ok || result.status !== "SENT") setError(result.detail ?? result.error ?? "Retry failed.");
    router.refresh();
  }
  const tone: Record<string, string> = { SENT: "text-green-700", FAILED: "text-rose-700", RETRYING: "text-amber-700", SKIPPED: "text-slate-500" };
  const label: Record<string, string> = { SENT: "sent", FAILED: "failed", RETRYING: "waiting to retry", SKIPPED: "not sent" };
  return (
    <div className="mt-2 overflow-x-auto">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <table className="w-full text-sm" data-email-log>
        <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Time (UTC)</th><th>To</th><th>Email</th><th>Pharmacy</th><th>Status</th><th>Tries</th><th /></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? <tr><td colSpan={7} className="py-2 text-slate-500">No emails yet.</td></tr> : rows.map((row) => (
            <tr key={row.id} data-delivery={row.status} className="align-top">
              <td className="py-1 whitespace-nowrap">{time(row.created_at)}</td>
              <td className="break-all">{row.recipient}</td>
              <td>{row.subject}<span className="block text-xs text-slate-500">{row.category}{row.template ? ` · ${row.template}` : ""}{row.provider ? ` · ${row.provider}` : ""}</span></td>
              <td>{row.pharmacy ?? "—"}</td>
              <td className={tone[row.status]}>{label[row.status] ?? row.status}{row.status === "RETRYING" && row.next_attempt_at ? <span className="block text-xs">next {time(row.next_attempt_at)}</span> : null}{row.last_error && row.status !== "SENT" ? <span className="block text-xs text-slate-500">{row.last_error}</span> : null}</td>
              <td>{row.attempts}</td>
              <td>{row.retryable && row.status !== "SENT" ? <button type="button" disabled={busy !== null} onClick={() => void retry(row.id)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-60" data-retry>{busy === row.id ? "Sending…" : "Send again"}</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
