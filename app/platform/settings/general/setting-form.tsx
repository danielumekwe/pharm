"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type FieldSpec = { name: string; label: string; type: "text" | "boolean" };

/** A small form for a platform setting made of text and on/off fields. */
export function SettingForm({ settingKey, value: initial, fields }: { settingKey: string; value: Record<string, unknown>; fields: FieldSpec[] }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch(`/api/platform/settings/${settingKey}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return setMessage({ tone: "error", text: result.error ?? "Could not save." });
    setMessage({ tone: "success", text: "Saved." });
    router.refresh();
  }
  return (
    <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2" data-setting-form={settingKey}>
      {fields.map((field) => field.type === "boolean" ? (
        <label key={field.name} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(value[field.name])} onChange={(event) => setValue({ ...value, [field.name]: event.target.checked })} /> {field.label}</label>
      ) : (
        <Field key={field.name} label={field.label}><input className={inputClass} value={String(value[field.name] ?? "")} onChange={(event) => setValue({ ...value, [field.name]: event.target.value })} /></Field>
      ))}
      {message ? <div className="sm:col-span-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <div className="sm:col-span-2"><button type="submit" className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800">Save</button></div>
    </form>
  );
}
