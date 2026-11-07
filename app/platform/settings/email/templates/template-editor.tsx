"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Template = { key: string; label: string; when: string; variables: string[]; required: readonly string[]; subject: string; body: string; customised: boolean };
type Preview = { subject: string; text: string; html: string };

export function TemplateEditor({ template }: { template: Template }) {
  const router = useRouter();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/platform/email/templates/${template.key}`;

  async function call(method: "PUT" | "DELETE" | "POST", path = url) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify({ subject, body }) });
    const result = (await response.json().catch(() => ({}))) as { error?: string; template?: Template } & Partial<Preview>;
    setBusy(false);
    if (!response.ok) {
      setMessage({ tone: "error", text: result.error ?? "Something went wrong." });
      return null;
    }
    return result;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (await call("PUT")) {
      setMessage({ tone: "success", text: "Saved. New emails use this text." });
      router.refresh();
    }
  }

  async function reset() {
    if (!window.confirm("Replace this template with the built-in default?")) return;
    const result = await call("DELETE");
    if (result?.template) {
      setSubject(result.template.subject);
      setBody(result.template.body);
      setPreview(null);
      setMessage({ tone: "success", text: "Back to the default." });
      router.refresh();
    }
  }

  async function show() {
    const result = await call("POST", `${url}/preview`);
    if (result) setPreview({ subject: result.subject ?? "", text: result.text ?? "", html: result.html ?? "" });
  }

  return (
    <form onSubmit={save} className="space-y-4" data-template-editor={template.key}>
      <div>
        <h2 className="text-lg font-semibold">{template.label}</h2>
        <p className="text-sm text-slate-600">Sent {template.when}.</p>
        <p className="mt-2 text-xs text-slate-600">
          Variables: {template.variables.map((name) => <code key={name} className={`mr-1 rounded px-1 ${template.required.includes(name) ? "bg-amber-100" : "bg-slate-100"}`}>{`{{${name}}}`}</code>)}
          {template.required.length ? <span className="block">Highlighted variables must stay in the email.</span> : null}
        </p>
      </div>
      <Field label="Subject"><input className={inputClass} value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} /></Field>
      <Field label="Body (plain text; links become clickable)"><textarea className={`${inputClass} min-h-64 font-mono text-sm`} value={body} maxLength={10_000} onChange={(event) => setBody(event.target.value)} /></Field>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">Save</button>
        <button type="button" disabled={busy} onClick={() => void show()} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">Preview</button>
        {template.customised ? <button type="button" disabled={busy} onClick={() => void reset()} className="rounded-xl border border-rose-300 px-5 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">Reset to default</button> : null}
      </div>
      {preview ? (
        <div className="rounded-xl border border-slate-200" data-template-preview>
          <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">Subject:</span> {preview.subject}</p>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-96 w-full bg-white" />
        </div>
      ) : null}
    </form>
  );
}
