"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Secret = { set: boolean; hint: string | null };
type TypeInfo = { key: string; label: string; variables: readonly string[] };
type Value = {
  enabled: boolean; baseUrl: string; agentId: string; wabaId: string; phoneNumberId: string; senderNumber: string; defaultCountryCode: string;
  types: Record<string, boolean>; alertCapPerDay: number;
};
type Setting = { value: Value; secrets: { apiKey: Secret; webhookKey: Secret } };
type Message = { tone: "success" | "error"; text: string } | null;
export type Template = { id: string; name: string; notification_type: string; template_key: string | null; template_alias: string | null; language: string; category: string; status: string; status_note: string | null; variables: string[]; active: boolean; updated_at: string; updated_by: string | null };

const button = "rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60";
const DATA_CENTRES = [["https://cpaas.zoho.com", "United States (zoho.com)"], ["https://cpaas.zoho.eu", "Europe (zoho.eu)"], ["https://cpaas.zoho.in", "India (zoho.in)"], ["https://cpaas.zoho.com.au", "Australia (zoho.com.au)"], ["https://cpaas.zoho.jp", "Japan (zoho.jp)"], ["https://cpaas.zoho.ca", "Canada (zoho.ca)"], ["https://cpaas.zoho.sa", "Saudi Arabia (zoho.sa)"]];

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; detail?: string; ok?: boolean };
  return { ok: response.ok, result };
}

/** Credentials are write-only: the page shows whether each is saved and its last characters, never the value. */
export function WhatsAppSettingsForm({ setting, types, webhookUrl }: { setting: Setting; types: TypeInfo[]; webhookUrl: string }) {
  const router = useRouter();
  const [value, setValue] = useState(setting.value);
  const [secrets, setSecrets] = useState({ apiKey: "", webhookKey: "" });
  const [clear, setClear] = useState({ apiKey: false, webhookKey: false });
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Value>) => setValue({ ...value, ...patch });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const body = { value, secrets: Object.fromEntries((["apiKey", "webhookKey"] as const).map((name) => [name, clear[name] ? null : secrets[name]])) };
    const { ok, result } = await call("/api/platform/settings/whatsapp.zoho", "PUT", body);
    setBusy(false);
    setSecrets({ apiKey: "", webhookKey: "" }); // typed credentials are not kept in the page
    setClear({ apiKey: false, webhookKey: false });
    setMessage(ok ? { tone: "success", text: "Saved." } : { tone: "error", text: result.error ?? "Could not save." });
    if (ok) router.refresh();
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const { result } = await call("/api/platform/settings/whatsapp.zoho/test", "POST");
    setBusy(false);
    setMessage({ tone: result.ok ? "success" : "error", text: result.detail ?? result.error ?? "Test failed." });
    router.refresh();
  }

  const secretField = (name: "apiKey" | "webhookKey", label: string, hint: string) => {
    const saved = setting.secrets[name];
    return (
      <Field label={label} hint={saved.set ? `Saved (${saved.hint}). Leave blank to keep it.` : hint}>
        <input type="password" autoComplete="new-password" spellCheck={false} className={inputClass} value={secrets[name]} placeholder={saved.set ? saved.hint ?? "" : ""} onChange={(event) => setSecrets({ ...secrets, [name]: event.target.value })} data-secret={name} />
        {saved.set ? <label className="mt-1 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={clear[name]} onChange={(event) => setClear({ ...clear, [name]: event.target.checked })} /> Remove the saved value</label> : null}
      </Field>
    );
  };

  return (
    <form onSubmit={save} className="space-y-4" data-whatsapp-form>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} /> Send WhatsApp notifications through Zoho CPaaS</label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Zoho data centre (API base URL)" hint="Where your Zoho CPaaS account is hosted.">
          <select className={inputClass} value={value.baseUrl} onChange={(event) => set({ baseUrl: event.target.value })}>
            {DATA_CENTRES.map(([url, label]) => <option key={url} value={url}>{label} — {url}</option>)}
          </select>
        </Field>
        {secretField("apiKey", "Agent API key", "Zoho CPaaS → Agents → mailer → API. Sent as \"Zoho-enczapikey …\".")}
        <Field label="Agent ID (optional)" hint="Leave blank to use the agent the API key belongs to."><input className={inputClass} spellCheck={false} value={value.agentId} onChange={(event) => set({ agentId: event.target.value.trim() })} /></Field>
        <Field label="WhatsApp sender number" hint="International format, as connected in Zoho (PHARMA ERP)."><input className={inputClass} value={value.senderNumber} placeholder="+234…" onChange={(event) => set({ senderNumber: event.target.value.replace(/\s/g, "") })} /></Field>
        <Field label="WABA ID"><input className={inputClass} inputMode="numeric" value={value.wabaId} onChange={(event) => set({ wabaId: event.target.value.trim() })} /></Field>
        <Field label="Phone Number ID"><input className={inputClass} inputMode="numeric" value={value.phoneNumberId} onChange={(event) => set({ phoneNumberId: event.target.value.trim() })} /></Field>
        <Field label="Default country code" hint="For numbers typed without one (0803… → +234803…)."><input className={inputClass} inputMode="numeric" value={value.defaultCountryCode} onChange={(event) => set({ defaultCountryCode: event.target.value.trim() })} /></Field>
        <Field label="Alert messages per pharmacy per day" hint="Cost control for low-stock, out-of-stock and expiry alerts."><input type="number" min={1} max={500} className={inputClass} value={value.alertCapPerDay} onChange={(event) => set({ alertCapPerDay: Number(event.target.value) })} /></Field>
        {secretField("webhookKey", "Webhook Authentication Key", "Zoho CPaaS → Agents → Webhooks → Authentication Key. Used to verify delivery reports.")}
        <Field label="Webhook callback URL" hint="Enter this in Zoho CPaaS → Agents → Webhooks, with the WhatsApp delivered, read and undelivered events."><input readOnly className={`${inputClass} bg-slate-50`} value={webhookUrl} onFocus={(event) => event.target.select()} data-webhook-url /></Field>
      </div>
      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">Notification types (platform-wide)</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {types.map((type) => (
            <label key={type.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.types[type.key] !== false} onChange={(event) => set({ types: { ...value.types, [type.key]: event.target.checked } })} /> {type.label}</label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">Off here stops that type for every pharmacy. Pharmacies can also switch types off for themselves.</p>
      </fieldset>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={`${button} bg-green-700 text-white hover:bg-green-800`}>{busy ? "Working…" : "Save"}</button>
        <button type="button" disabled={busy} onClick={() => void test()} className={`${button} border border-slate-300 hover:bg-slate-50`} data-test-connection>Test connection</button>
      </div>
      <p className="text-xs text-slate-500">Credentials are encrypted on the server and never sent back to this page. Test connection makes a read-only call to Zoho (message logs) and never sends a message.</p>
    </form>
  );
}

export function TestMessage({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const usable = templates.filter((row) => row.status === "APPROVED" && row.active);
  const [phone, setPhone] = useState("");
  const [templateId, setTemplateId] = useState(usable[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { ok, result } = await call("/api/platform/whatsapp/test-message", "POST", { phone, templateId, confirmed });
    setBusy(false);
    setMessage({ tone: ok && result.ok ? "success" : "error", text: result.detail ?? result.error ?? "Not sent." });
    router.refresh();
  }
  return (
    <form onSubmit={send} className="space-y-2 text-sm" data-test-message>
      <h2 className="font-semibold">Send a test message</h2>
      {usable.length === 0 ? <p className="text-slate-600">No approved, active template yet. Add one below and mark it Approved once Zoho / Meta has approved it.</p> : (
        <>
          <Field label="Recipient number"><input required className={inputClass} value={phone} placeholder="+234…" onChange={(event) => setPhone(event.target.value)} /></Field>
          <Field label="Approved template"><select className={inputClass} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{usable.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.notification_type})</option>)}</select></Field>
          <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> The owner of this number agreed to receive this test message. It uses clearly marked test values, never pharmacy data.</label>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <button type="submit" disabled={busy || !confirmed} className={`${button} border border-slate-300 hover:bg-slate-50`}>{busy ? "Sending…" : "Send test message"}</button>
        </>
      )}
    </form>
  );
}

const EMPTY = { name: "", notificationType: "daily_report", templateKey: "", templateAlias: "", language: "en", category: "UTILITY", status: "PENDING", statusNote: "", variables: "", active: true };
const STATUS_TONE: Record<string, string> = { APPROVED: "bg-green-100 text-green-800", PENDING: "bg-amber-100 text-amber-800", REJECTED: "bg-rose-100 text-rose-800", PAUSED: "bg-slate-100 text-slate-700" };

export function Templates({ templates, types, problems }: { templates: Template[]; types: TypeInfo[]; problems: Record<string, string | null> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const type = types.find((row) => row.key === form.notificationType);

  function edit(row: Template | null) {
    setMessage(null);
    if (!row) {
      setEditing("new");
      setForm(EMPTY);
      return;
    }
    setEditing(row.id);
    setForm({ name: row.name, notificationType: row.notification_type, templateKey: row.template_key ?? "", templateAlias: row.template_alias ?? "", language: row.language, category: row.category, status: row.status, statusNote: row.status_note ?? "", variables: row.variables.join(", "), active: row.active });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const body = { ...form, variables: form.variables.split(/[\s,]+/).filter(Boolean) };
    const { ok, result } = editing === "new" ? await call("/api/platform/whatsapp/templates", "POST", body) : await call(`/api/platform/whatsapp/templates/${encodeURIComponent(editing ?? "")}`, "PUT", body);
    setBusy(false);
    if (!ok) return setMessage({ tone: "error", text: result.error ?? "Could not save." });
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-3" data-templates>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Templates</h2>
        <button type="button" onClick={() => edit(null)} className={`${button} border border-slate-300 hover:bg-slate-50`}>Add template</button>
      </div>
      <p className="text-sm text-slate-600">WhatsApp only delivers templates approved by Meta. Create and submit each template in Zoho CPaaS, then record it here with its key or alias and merge keys. A template is used only when it is marked <strong>Approved</strong> and active. Zoho has no API to read approval status, so check it in Zoho before marking it Approved. A template Zoho refuses when sending is marked Rejected automatically.</p>
      <ul className="grid gap-1 text-sm sm:grid-cols-2" data-template-coverage>
        {types.map((row) => <li key={row.key} className={problems[row.key] ? "text-amber-800" : "text-green-800"}>{problems[row.key] ? "⚠" : "✓"} {row.label}{problems[row.key] ? <span className="block text-xs text-slate-500">{problems[row.key]}</span> : null}</li>)}
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Name</th><th>Notification</th><th>Key / alias</th><th>Language</th><th>Category</th><th>Variables</th><th>Status</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {templates.length === 0 ? <tr><td colSpan={8} className="py-2 text-slate-500">No templates yet.</td></tr> : templates.map((row) => (
              <tr key={row.id} className="align-top" data-template={row.status}>
                <td className="py-1.5 font-medium">{row.name}{row.active ? "" : <span className="block text-xs text-slate-500">inactive</span>}</td>
                <td>{types.find((item) => item.key === row.notification_type)?.label ?? row.notification_type}</td>
                <td className="break-all font-mono text-xs">{row.template_key ?? `alias: ${row.template_alias}`}</td>
                <td>{row.language}</td><td>{row.category.toLowerCase()}</td>
                <td className="font-mono text-xs">{row.variables.join(", ") || "—"}</td>
                <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[row.status]}`}>{row.status.toLowerCase()}</span>{row.status_note ? <span className="block text-xs text-slate-500">{row.status_note}</span> : null}</td>
                <td><button type="button" onClick={() => edit(row)} className="text-xs font-semibold text-green-800 hover:underline">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <form onSubmit={save} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2" data-template-form>
          <Field label="Template name"><input required className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Notification type"><select className={inputClass} value={form.notificationType} onChange={(event) => setForm({ ...form, notificationType: event.target.value })}>{types.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}</select></Field>
          <Field label="Template key (from Zoho)" hint="Use the key or the alias, not both."><input className={inputClass} spellCheck={false} value={form.templateKey} onChange={(event) => setForm({ ...form, templateKey: event.target.value.trim() })} /></Field>
          <Field label="Template alias"><input className={inputClass} spellCheck={false} value={form.templateAlias} onChange={(event) => setForm({ ...form, templateAlias: event.target.value.trim() })} /></Field>
          <Field label="Language"><input className={inputClass} value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value.trim() })} /></Field>
          <Field label="Category"><select className={inputClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option><option value="AUTHENTICATION">Authentication</option></select></Field>
          <div className="sm:col-span-2"><Field label="Merge keys used by the template" hint={`Comma separated, exactly as in Zoho. Available for this type: ${type?.variables.join(", ") ?? ""}`}><input className={inputClass} spellCheck={false} value={form.variables} onChange={(event) => setForm({ ...form, variables: event.target.value })} /></Field></div>
          <Field label="Approval status (as shown in Zoho CPaaS)"><select className={inputClass} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="PENDING">Pending approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="PAUSED">Paused</option></select></Field>
          <Field label="Note (optional)"><input className={inputClass} value={form.statusNote} onChange={(event) => setForm({ ...form, statusNote: event.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active</label>
          {message ? <div className="sm:col-span-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={busy} className={`${button} bg-green-700 text-white hover:bg-green-800`}>{busy ? "Saving…" : "Save template"}</button>
            <button type="button" onClick={() => setEditing(null)} className={`${button} border border-slate-300 hover:bg-white`}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
