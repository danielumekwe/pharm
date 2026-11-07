"use client";

import { RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { BrandLogo, useBranding } from "@/components/branding";

import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { useAction } from "@/components/erp/use-action";
import type { SystemSettings } from "@/lib/erp/types";
import { dateTime } from "@/lib/format";

type NumberKey = Exclude<keyof SystemSettings, "businessName" | "logoFile" | "expiryIntervals" | "nearExpiryDays" | "impersonation" | "lowStock" | "alertEmail">;

const FIELDS: { key: NumberKey; label: string; hint: string; suffix: string; section: string }[] = [
  { key: "vatRate", label: "VAT rate", hint: "Charged on every sale. Nigeria's standard rate is 7.5%.", suffix: "%", section: "Sales & tax" },
  { key: "supplierPaymentApprovalThreshold", label: "Supplier payment approval threshold", hint: "Payments at or above this need approval rights.", suffix: "₦", section: "Sales & tax" },
  { key: "minShelfLifeDays", label: "Minimum shelf life at receipt", hint: "Deliveries closer to expiry are rejected.", suffix: "days", section: "Inventory & compliance" },
  { key: "criticalShortagePct", label: "Critical shortage level", hint: "Stock at or below this share of the minimum triggers an immediate alert.", suffix: "% of min", section: "Inventory & compliance" },
  { key: "dailySummaryHour", label: "Daily alert summary time", hint: "Hour of the day (server time) the inventory summary is sent.", suffix: "0–23 h", section: "Inventory & compliance" },
  { key: "passwordMinLength", label: "Minimum password length", hint: "Applies to new passwords and invitations.", suffix: "chars", section: "Security" },
  { key: "inviteValidityHours", label: "Invitation link validity", hint: "How long a staff invitation can be used.", suffix: "hours", section: "Security" },
];

type DatabaseStats = { database: string; counts: Record<string, number>; lastFlush: { at: string; changed: number; ms: number } | null };

export function SettingsForm({ settings, defaults, history, database }: { settings: SystemSettings; defaults: SystemSettings; history: { id: string; at: string; actor: string; summary: string }[]; database: DatabaseStats | null }) {
  const { run, error, busy } = useAction();
  const toForm = (value: SystemSettings) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? item.join(", ") : String(item)])) as Record<keyof SystemSettings, string>;
  const [form, setForm] = useState(() => toForm(settings));
  const dirty = (Object.keys(settings) as (keyof SystemSettings)[]).filter((key) => key !== "logoFile").some((key) => toForm(settings)[key] !== form[key]);
  const sections = Array.from(new Set(FIELDS.map((field) => field.section)));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Administration" title="System settings" description="Organisation-wide rules used by sales, receiving, compliance and security. Changes take effect immediately and are recorded in the audit trail." />
      <Panel id="business-profile" title="Branding" description="Shown in the browser tab, on the sign-in page and in the sidebar for everyone.">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Site title / business name" hint="Save settings below to apply. 3–80 characters.">
            <TextInput maxLength={80} value={form.businessName} onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))} />
          </Field>
          <LogoField />
        </div>
      </Panel>
      <ImpersonationPanel initial={settings.impersonation} />
      <Panel title="Near-expiry warning intervals" description="Batches are grouped into the nearest window below. Used by alerts, dashboards and reports.">
        <div className="max-w-md">
          <Field label="Intervals (days, comma-separated)" hint={`Default: ${defaults.expiryIntervals.join(", ")}. Up to 8 values between 7 and 730.`}>
            <TextInput value={form.expiryIntervals} onChange={(event) => setForm((current) => ({ ...current, expiryIntervals: event.target.value }))} />
          </Field>
        </div>
      </Panel>
      {sections.map((section) => (
        <Panel key={section} title={section}>
          <div className="grid gap-4 md:grid-cols-2">
            {FIELDS.filter((field) => field.section === section).map((field) => (
              <Field key={field.key} label={`${field.label} (${field.suffix})`} hint={`${field.hint} Default: ${defaults[field.key].toLocaleString()}.`}>
                <TextInput type="number" value={form[field.key]} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
              </Field>
            ))}
          </div>
        </Panel>
      ))}
      <FormError message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton tone="secondary" disabled={busy} onClick={async () => { if (window.confirm("Reset all settings to defaults?")) { const result = await run<SystemSettings>("/api/settings", "POST", { action: "reset" }); if (result) setForm(toForm(result)); } }}>
          <RotateCcw className="h-4 w-4" /> Reset to defaults
        </ActionButton>
        <ActionButton
          disabled={busy || !dirty}
          onClick={() =>
            void run("/api/settings", "POST", {
              action: "update",
              businessName: form.businessName,
              ...Object.fromEntries(FIELDS.map((field) => [field.key, Number(form[field.key])])),
              expiryIntervals: form.expiryIntervals.split(/[,\s]+/).filter(Boolean).map(Number),
            })
          }
        >
          <Save className="h-4 w-4" /> Save settings
        </ActionButton>
      </div>
      <Panel title="Database" description="PostgreSQL system of record. Mutations commit within a database transaction before the response is returned.">
        {database ? (
          <div className="space-y-3 text-sm">
            <p className="font-mono text-xs text-slate-400">{database.database}</p>
            <p className="text-slate-300">Last save: {database.lastFlush ? `${dateTime(database.lastFlush.at)} · ${database.lastFlush.changed} row(s) in ${database.lastFlush.ms} ms` : "no changes since start"}</p>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(database.counts).map(([table, count]) => (
                <div key={table} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <p className="truncate text-[11px] text-slate-500">{table.replace(/_/g, " ")}</p>
                  <p className="font-semibold tabular-nums text-white">{count.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-amber-300">Database not initialised in this process.</p>
        )}
      </Panel>
      <Panel title="Recent changes">
        {history.length ? (
          <ul className="space-y-2 text-sm">{history.map((event) => <li key={event.id} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"><p>{event.summary}</p><p className="text-[11px] text-slate-500">{dateTime(event.at)} · {event.actor}</p></li>)}</ul>
        ) : (
          <p className="text-sm text-slate-500">No changes yet.</p>
        )}
      </Panel>
    </div>
  );
}

function LogoField() {
  const { run, error, busy } = useAction();
  const { logoFile } = useBranding();
  const input = useRef<HTMLInputElement>(null);
  async function upload(file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    await run("/api/settings/logo", "POST", body);
    if (input.current) input.current.value = "";
  }
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-200">Logo</p>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-slate-800 bg-white p-2">
          <BrandLogo id="settings-preview" className="h-16 w-16" />
        </div>
        <div className="space-y-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={busy} onClick={() => input.current?.click()}>
              <Upload className="h-4 w-4" /> {logoFile ? "Replace logo" : "Upload logo"}
            </ActionButton>
            {logoFile ? (
              <ActionButton tone="secondary" disabled={busy} onClick={() => { if (window.confirm("Remove the logo and use the built-in one?")) void run("/api/settings/logo", "DELETE"); }}>
                <Trash2 className="h-4 w-4" /> Remove
              </ActionButton>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 512 KB. A square image works best. Applies immediately.</p>
        </div>
      </div>
      <FormError message={error} />
    </div>
  );
}

function ImpersonationPanel({ initial }: { initial: SystemSettings["impersonation"] }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  return (
    <Panel title="Super Admin user impersonation" description="“Switch user” lets the Pharmacy Super Admin act as another user with exactly that user's role, outlets and permissions. Sessions are server-side, time-limited and fully audited.">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm md:col-span-3">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-green-700" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
          <span><span className="font-medium text-white">Enable Super Admin User Impersonation</span><span className="block text-xs text-slate-400">When off, no new sessions can start and the API refuses attempts.</span></span>
        </label>
        <Field label="When switched off, running sessions…">
          <SelectInput value={form.onDisable} onChange={(event) => setForm((current) => ({ ...current, onDisable: event.target.value as "terminate" | "expire" }))} options={[{ value: "terminate", label: "End immediately (recommended)" }, { value: "expire", label: "May continue until their time limit" }]} />
        </Field>
        <Field label="Maximum session length (minutes)" hint="5–240">
          <TextInput type="number" min={5} max={240} value={form.maxMinutes} onChange={(event) => setForm((current) => ({ ...current, maxMinutes: Math.floor(Number(event.target.value) || 0) }))} />
        </Field>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {note ? <span className="text-sm text-emerald-300">{note}</span> : null}
        <FormError message={error} />
        <ActionButton
          disabled={busy || !dirty}
          onClick={async () => {
            const result = await run<{ terminated: number }>("/api/settings", "POST", { action: "impersonation", ...form });
            if (result) setNote(result.terminated ? `Saved — ${result.terminated} active session(s) ended.` : "Saved.");
          }}
        >
          <Save className="h-4 w-4" /> Save impersonation settings
        </ActionButton>
      </div>
    </Panel>
  );
}
