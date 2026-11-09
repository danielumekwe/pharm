"use client";

import { useState } from "react";

import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Panel } from "@/components/erp/stat-card";
import { useAction } from "@/components/erp/use-action";

type TypeInfo = { key: string; label: string; platformOn: boolean; problem: string | null };
type Recipient = { id: string; name: string; phone: string; types: string[]; outlet_id: string | null; consent_at: string; consent_by: string; consent_note: string | null; opted_out_at: string | null; opt_out_source: string | null };
type MessageRow = { id: string; created_at: string; recipient_phone: string; recipient_name: string | null; category: string; template_name: string | null; status: string; sent_at: string | null; delivered_at: string | null; read_at: string | null; failure_reason: string | null };
type Props = {
  available: boolean;
  preferences: { dailyReportChannel: "email" | "whatsapp" | "both"; types: Record<string, boolean> };
  types: TypeInfo[];
  recipients: Recipient[];
  messages: MessageRow[];
  outlets: { id: string; name: string }[];
  readOnly: boolean;
};

const time = (value: string | null) => (value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const TONE: Record<string, string> = { DELIVERED: "text-emerald-300", READ: "text-emerald-300", SENT: "text-sky-300", FAILED: "text-rose-300", UNDELIVERED: "text-rose-300", SKIPPED: "text-slate-400", QUEUED: "text-amber-300", SENDING: "text-amber-300" };

export function WhatsAppSettings({ available, preferences, types, recipients, messages, outlets, readOnly }: Props) {
  const { run, busy, error } = useAction();
  const [channel, setChannel] = useState(preferences.dailyReportChannel);
  const [enabled, setEnabled] = useState(preferences.types);
  const [draft, setDraft] = useState({ name: "", phone: "", outletId: "", types: ["daily_report"] as string[], consent: false, consentNote: "" });
  const [optIn, setOptIn] = useState<string | null>(null);
  const label = (key: string) => types.find((type) => type.key === key)?.label ?? key;
  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);

  return (
    <div className="space-y-6" data-whatsapp-settings>
      {!available ? <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" data-whatsapp-unavailable>WhatsApp messages are not switched on for the platform yet. You can add recipients now; messages start once Web365 turns WhatsApp on.</p> : null}
      <FormError message={error} />

      <Panel title="Daily report and notifications" description="Choose how the daily report is delivered and which notifications go to WhatsApp.">
        <div className="space-y-4">
          <Field label="Daily pharmacy report">
            <SelectInput value={channel} disabled={readOnly} onChange={(event) => setChannel(event.target.value as typeof channel)} options={[{ value: "email", label: "Email only" }, { value: "whatsapp", label: "WhatsApp only" }, { value: "both", label: "Email and WhatsApp" }]} />
          </Field>
          <ul className="grid gap-2 sm:grid-cols-2">
            {types.map((type) => (
              <li key={type.key} className="rounded-lg border border-slate-800 px-3 py-2 text-sm">
                <label className="flex items-center gap-2 text-slate-100">
                  <input type="checkbox" disabled={readOnly || !type.platformOn} checked={type.platformOn && enabled[type.key] !== false} onChange={(event) => setEnabled({ ...enabled, [type.key]: event.target.checked })} /> {type.label}
                </label>
                {!type.platformOn ? <p className="mt-1 text-xs text-slate-500">Switched off by Web365.</p> : type.problem ? <p className="mt-1 text-xs text-amber-300">{type.problem}</p> : null}
              </li>
            ))}
          </ul>
          {!readOnly ? <ActionButton disabled={busy} onClick={() => void run("/api/whatsapp/settings", "PATCH", { dailyReportChannel: channel, types: enabled })}>Save preferences</ActionButton> : null}
          <p className="text-xs text-slate-500">The WhatsApp report is a short summary with a link to the full report, which opens after signing in. Messages are sent in the background, never during a sale.</p>
        </div>
      </Panel>

      <Panel title="Recipients" description="Only people listed here receive WhatsApp messages from this pharmacy, and only after they agree.">
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-recipients>
              <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="py-1">Name</th><th>Number</th><th>Receives</th><th>Consent</th><th>Status</th><th /></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {recipients.length === 0 ? <tr><td colSpan={6} className="py-2 text-slate-500">No recipients yet.</td></tr> : recipients.map((row) => (
                  <tr key={row.id} className="align-top" data-recipient={row.opted_out_at ? "opted-out" : "active"}>
                    <td className="py-2 text-slate-100">{row.name}{row.outlet_id ? <span className="block text-xs text-slate-500">{outlets.find((outlet) => outlet.id === row.outlet_id)?.name ?? row.outlet_id}</span> : null}</td>
                    <td className="whitespace-nowrap text-slate-300">{row.phone}</td>
                    <td className="text-xs text-slate-300">{row.types.map(label).join(", ")}</td>
                    <td className="text-xs text-slate-400">{time(row.consent_at)}<span className="block">by {row.consent_by}</span>{row.consent_note ? <span className="block">{row.consent_note}</span> : null}</td>
                    <td className="text-xs">{row.opted_out_at ? <span className="text-amber-300">Opted out {time(row.opted_out_at)}{row.opt_out_source === "link" ? " (by link)" : ""}</span> : <span className="text-emerald-300">Receiving</span>}</td>
                    <td className="whitespace-nowrap text-right">
                      {readOnly ? null : row.opted_out_at ? (
                        optIn === row.id ? (
                          <span className="flex flex-col items-end gap-1 text-xs text-slate-300">
                            <span>Has {row.name} agreed again to receive messages?</span>
                            <span className="flex gap-1"><ActionButton tone="secondary" disabled={busy} onClick={() => void run(`/api/whatsapp/recipients/${row.id}`, "PATCH", { optedOut: false, consent: true }).then(() => setOptIn(null))}>Yes, opt in</ActionButton><ActionButton tone="ghost" onClick={() => setOptIn(null)}>Cancel</ActionButton></span>
                          </span>
                        ) : <ActionButton tone="secondary" onClick={() => setOptIn(row.id)}>Opt in again</ActionButton>
                      ) : <ActionButton tone="secondary" disabled={busy} onClick={() => void run(`/api/whatsapp/recipients/${row.id}`, "PATCH", { optedOut: true })}>Opt out</ActionButton>}
                      {readOnly ? null : <ActionButton tone="ghost" disabled={busy} onClick={() => void run(`/api/whatsapp/recipients/${row.id}`, "DELETE")}>Remove</ActionButton>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!readOnly ? (
            <form
              className="grid gap-3 rounded-xl border border-slate-800 p-4 sm:grid-cols-3"
              data-add-recipient
              onSubmit={(event) => {
                event.preventDefault();
                void run("/api/whatsapp/recipients", "POST", { ...draft, outletId: draft.outletId || null }).then((result) => {
                  if (result) setDraft({ name: "", phone: "", outletId: "", types: ["daily_report"], consent: false, consentNote: "" });
                });
              }}
            >
              <Field label="Name"><TextInput required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
              <Field label="WhatsApp number" hint="e.g. 0803 123 4567 or +234…"><TextInput required value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></Field>
              <Field label="Outlet" hint="For outlet summaries and alerts."><SelectInput value={draft.outletId} onChange={(event) => setDraft({ ...draft, outletId: event.target.value })} options={[{ value: "", label: "All outlets" }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]} /></Field>
              <fieldset className="sm:col-span-3">
                <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Sends</legend>
                <div className="grid gap-1 sm:grid-cols-3">
                  {types.map((type) => <label key={type.key} className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={draft.types.includes(type.key)} onChange={() => setDraft({ ...draft, types: toggle(draft.types, type.key) })} /> {type.label}</label>)}
                </div>
              </fieldset>
              <label className="flex items-start gap-2 text-sm text-slate-200 sm:col-span-2"><input type="checkbox" className="mt-1" checked={draft.consent} onChange={(event) => setDraft({ ...draft, consent: event.target.checked })} /> This person agreed to receive these WhatsApp messages from our pharmacy. The date and your name are recorded.</label>
              <Field label="How consent was given (optional)"><TextInput value={draft.consentNote} placeholder="e.g. signed staff form" onChange={(event) => setDraft({ ...draft, consentNote: event.target.value })} /></Field>
              <div className="sm:col-span-3"><ActionButton type="submit" disabled={busy || !draft.consent || !draft.types.length}>Add recipient</ActionButton></div>
            </form>
          ) : null}
          <p className="text-xs text-slate-500">Every message includes a link the recipient can use to stop receiving messages. Opted-out numbers receive nothing until you opt them in again with their agreement.</p>
        </div>
      </Panel>

      <Panel title="Message history" description="WhatsApp messages sent for this pharmacy (most recent 100).">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-whatsapp-history>
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="py-1">Queued</th><th>To</th><th>Notification</th><th>Status</th><th>Delivered</th><th>Read</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {messages.length === 0 ? <tr><td colSpan={6} className="py-2 text-slate-500">No messages yet.</td></tr> : messages.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap py-2 text-slate-300">{time(row.created_at)}</td>
                  <td className="text-slate-300">{row.recipient_name ?? row.recipient_phone}<span className="block text-xs text-slate-500">{row.recipient_phone}</span></td>
                  <td className="text-slate-300">{label(row.category)}</td>
                  <td className={TONE[row.status] ?? "text-slate-300"}>{row.status.toLowerCase()}{row.failure_reason ? <span className="block text-xs text-slate-500">{row.failure_reason}</span> : null}</td>
                  <td className="whitespace-nowrap text-slate-400">{time(row.delivered_at)}</td>
                  <td className="whitespace-nowrap text-slate-400">{time(row.read_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
