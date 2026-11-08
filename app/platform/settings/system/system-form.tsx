"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Config = {
  maintenance: boolean;
  maintenanceMessage: string;
  registrationOpen: boolean;
  trialsEnabled: boolean;
  trialDaysOverride: number | null;
  features: { stock_transfers: boolean; regulatory_management: boolean };
  maxDocumentMB: number;
  documentTypes: Array<"pdf" | "png" | "jpeg">;
  maxLogoKB: number;
  jobs: { alertJobs: boolean; emailQueue: boolean };
};
type Message = { tone: "success" | "error"; text: string } | null;

const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) => (
  <label className="flex items-start gap-2 text-sm">
    <input type="checkbox" className="mt-1" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span><span className="font-medium">{label}</span>{hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}</span>
  </label>
);

export function SystemForm({ value: initial }: { value: Config }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<Message>(null);
  const set = (patch: Partial<Config>) => setValue({ ...value, ...patch });
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (value.maintenance && !initial.maintenance && !window.confirm("Turn maintenance mode on? Every pharmacy user is stopped until you turn it off.")) return;
    setMessage(null);
    const response = await fetch("/api/platform/settings/system.config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return setMessage({ tone: "error", text: result.error ?? "Could not save." });
    setMessage({ tone: "success", text: "Saved. It applies now." });
    router.refresh();
  }
  const type = (name: "pdf" | "png" | "jpeg") => (checked: boolean) => set({ documentTypes: checked ? [...new Set([...value.documentTypes, name])] : value.documentTypes.filter((entry) => entry !== name) });
  return (
    <form onSubmit={save} className="space-y-5" data-system-form>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Maintenance</legend>
        <Toggle checked={value.maintenance} onChange={(maintenance) => set({ maintenance })} label="Maintenance mode" hint="Pharmacy users cannot sign in, open pages or use the API; the Control Centre keeps working. Registration pauses too." />
        <Field label="Message shown to pharmacies"><input className={inputClass} maxLength={300} value={value.maintenanceMessage} placeholder="Pharmacy ERP is being updated. Please try again shortly." onChange={(event) => set({ maintenanceMessage: event.target.value })} /></Field>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="font-semibold sm:col-span-2">Registration and trials</legend>
        <Toggle checked={value.registrationOpen} onChange={(registrationOpen) => set({ registrationOpen })} label="New pharmacies can register themselves" hint="Off: only Web365 can create pharmacies." />
        <Toggle checked={value.trialsEnabled} onChange={(trialsEnabled) => set({ trialsEnabled })} label="Free trial for new pharmacies" hint="Off: new pharmacies must pay before they can use the system." />
        <Field label="Trial length (days)" hint="Blank: each plan's own trial days. Existing trials are not changed."><input type="number" min={1} max={90} className={inputClass} disabled={!value.trialsEnabled} value={value.trialDaysOverride ?? ""} onChange={(event) => set({ trialDaysOverride: event.target.value ? Number(event.target.value) : null })} /></Field>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Features (all pharmacies)</legend>
        <p className="text-xs text-slate-500">Off overrides every plan, for example while a feature has a problem. It is checked on the server for every request.</p>
        <Toggle checked={value.features.stock_transfers} onChange={(on) => set({ features: { ...value.features, stock_transfers: on } })} label="Stock transfers" />
        <Toggle checked={value.features.regulatory_management} onChange={(on) => set({ features: { ...value.features, regulatory_management: on } })} label="Regulatory management" />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="font-semibold sm:col-span-3">Uploads</legend>
        <Field label="Regulatory documents: largest file (MB)" hint="Hosting limits requests to about 4 MB on Vercel."><input type="number" min={1} max={10} className={inputClass} value={value.maxDocumentMB} onChange={(event) => set({ maxDocumentMB: Number(event.target.value) })} /></Field>
        <div className="text-sm"><span className="mb-1 block font-medium">Allowed document types</span><div className="flex gap-3">{(["pdf", "png", "jpeg"] as const).map((name) => <label key={name} className="flex items-center gap-1"><input type="checkbox" checked={value.documentTypes.includes(name)} onChange={(event) => type(name)(event.target.checked)} />{name.toUpperCase()}</label>)}</div><span className="mt-1 block text-xs text-slate-500">The file content is always checked against its type.</span></div>
        <Field label="Logo: largest file (KB)"><input type="number" min={64} max={2048} className={inputClass} value={value.maxLogoKB} onChange={(event) => set({ maxLogoKB: Number(event.target.value) })} /></Field>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Scheduled jobs</legend>
        <Toggle checked={value.jobs.alertJobs} onChange={(on) => set({ jobs: { ...value.jobs, alertJobs: on } })} label="Alert jobs (stock and expiry scans, daily and monthly summaries)" />
        <Toggle checked={value.jobs.emailQueue} onChange={(on) => set({ jobs: { ...value.jobs, emailQueue: on } })} label="Email retry queue" />
        <p className="text-xs text-slate-500">Switched-off jobs are skipped on schedule (and logged as skipped). “Run now” below still runs them.</p>
      </fieldset>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <button type="submit" className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800">Save</button>
    </form>
  );
}

export function RunJob({ job, label }: { job: "alert-jobs" | "email-queue"; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    const response = await fetch("/api/platform/system/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job }) });
    const result = (await response.json().catch(() => ({}))) as { error?: string; result?: Record<string, unknown> };
    setBusy(false);
    setNote(response.ok ? "Done." : result.error ?? "Failed.");
    router.refresh();
  }
  return <span className="flex items-center gap-1">{note ? <span className="text-xs text-slate-500">{note}</span> : null}<button type="button" disabled={busy} onClick={() => void run()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-60" data-run-job={job}>{busy ? "Running…" : label}</button></span>;
}

export function BackupNote() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: "", takenAt: "", location: "", note: "" });
  const [message, setMessage] = useState<Message>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/platform/system/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, takenAt: form.takenAt ? new Date(form.takenAt).toISOString() : "" }) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return setMessage({ tone: "error", text: result.error ?? "Could not save." });
    setOpen(false);
    setForm({ label: "", takenAt: "", location: "", note: "" });
    router.refresh();
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold text-green-800 hover:underline">Note a backup taken at the host…</button>;
  return (
    <form onSubmit={save} className="mt-2 grid gap-2 sm:grid-cols-2" data-backup-note>
      <input required placeholder="Name (e.g. Neon branch before release)" className={inputClass} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
      <input required type="datetime-local" className={inputClass} value={form.takenAt} onChange={(event) => setForm({ ...form, takenAt: event.target.value })} />
      <input placeholder="Where it is (branch name, file…)" className={inputClass} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
      <input placeholder="Note" className={inputClass} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
      {message ? <div className="sm:col-span-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <div className="flex gap-2"><button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Save</button><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs">Cancel</button></div>
    </form>
  );
}
