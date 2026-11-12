"use client";

import { Banknote, Boxes, Camera, FileSpreadsheet, History, Receipt, ScanText, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAction } from "@/components/erp/use-action";

import { JOB_TONES } from "./scanner/job-status";

type Settings = { provider: string | null; model: string | null; providerConfigured: boolean; providerProblem: string | null; aiApproved: boolean; changedBy: string | null; changedAt: string | null; canChange: boolean };
type JobSummary = { id: string; reference: string; title: string; categoryLabel: string; status: string; statusLabel: string; outletName: string; createdAt: string; createdBy: string; pages: number; records: number; approved: number; imported: number };
type Outlet = { id: string; name: string; code: string; warehouse: boolean };
type Category = "inventory" | "sales" | "expenses" | "suppliers";

const OPTIONS: { category: Category; title: string; text: string; icon: typeof Boxes }[] = [
  { category: "inventory", title: "Scan Inventory Records", text: "Stock books, stock-taking sheets, price lists and supplier invoices: products, batches, expiry dates and quantities.", icon: Boxes },
  { category: "sales", title: "Scan Historical Sales Records", text: "Sales registers, receipt books and daily sales totals. Kept on their original dates; stock is not deducted.", icon: Receipt },
  { category: "expenses", title: "Scan Expense Records", text: "Expense books and receipts: description, amount, date and who was paid.", icon: Banknote },
  { category: "suppliers", title: "Scan Supplier Records", text: "Supplier lists, invoices and statements: names, contacts, licence numbers and balances.", icon: Truck },
];

export function ImportCentre({
  canScan,
  canApprove,
  canSpreadsheet,
  settings,
  recent,
  outlets,
  defaultOutletId,
  stockModes,
  scope,
}: {
  canScan: boolean;
  canApprove: boolean;
  canSpreadsheet: boolean;
  settings: Settings | null;
  recent: JobSummary[];
  outlets: Outlet[];
  defaultOutletId: string;
  stockModes: Record<string, string>;
  scope?: string;
}) {
  const router = useRouter();
  const { run, error, setError, busy } = useAction();
  const [category, setCategory] = useState<Category | null>(null);
  const [form, setForm] = useState({ title: "", outletId: defaultOutletId, stockMode: "", note: "" });
  const [consent, setConsent] = useState(false);

  const open = (next: Category) => {
    setError(null);
    setForm({ title: "", outletId: next === "sales" ? outlets.find((outlet) => !outlet.warehouse)?.id ?? defaultOutletId : defaultOutletId, stockMode: "", note: "" });
    setCategory(next);
  };
  const create = async () => {
    if (!category) return;
    const job = await run<{ id: string }>("/api/document-scans", "POST", { category, title: form.title, outletId: form.outletId || undefined, stockMode: form.stockMode || undefined, note: form.note });
    if (job) router.push(`/data-migration/scanner/${encodeURIComponent(job.id)}`);
  };
  const toggleAi = async (approved: boolean) => {
    const result = await run("/api/document-scans/settings", "POST", { aiApproved: approved });
    if (result) setConsent(false);
  };

  const outletChoices = outlets.filter((outlet) => category !== "sales" || !outlet.warehouse);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings · Data migration"
        title="Data Import Centre"
        description="Move your pharmacy's existing records into PharmaERP: upload spreadsheets, or photograph your paper stock books and sales registers and let AI read them for you to check."
        scope={scope}
        actions={
          canScan ? (
            <Link href="/data-migration/scanner/history" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800">
              <History className="h-4 w-4" /> Previous scanning jobs
            </Link>
          ) : null
        }
      />

      {canSpreadsheet ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-300">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-semibold text-white">Spreadsheet import (Excel / CSV)</h4>
              <p className="mt-1 text-sm text-slate-400">Products and opening stock from a spreadsheet or another system&apos;s export, with preview, matching and rollback.</p>
            </div>
          </div>
          <Link href="/inventory/import" className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-[#fff] hover:bg-blue-700">
            Open Bulk Import
          </Link>
        </section>
      ) : null}

      {canScan && settings ? (
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 text-sky-300">
                <ScanText className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-semibold text-white">AI Document Scanner</h4>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                  Take pictures of handwritten or printed records with your phone, or upload JPEG, PNG or PDF scans. AI reads the pages; you check and correct every record before anything is saved. Nothing enters your live records until an authorised person approves it.
                </p>
              </div>
            </div>
          </div>

          <ol className="grid gap-2 text-xs text-slate-400 sm:grid-cols-4 lg:grid-cols-7">
            {["Choose record type", "Upload or photograph pages", "AI reads the pages", "Check and correct", "Approve", "Import into PharmaERP", "Download report"].map((step, index) => (
              <li key={step} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-600/20 text-[11px] font-semibold text-blue-300">{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>

          <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${settings.aiApproved && settings.providerConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
            <div className="flex items-start gap-2 text-sm">
              <ShieldCheck className={`mt-0.5 h-4 w-4 shrink-0 ${settings.aiApproved && settings.providerConfigured ? "text-emerald-300" : "text-amber-300"}`} />
              <div>
                {!settings.providerConfigured ? (
                  <p className="text-amber-200">AI reading is not set up on this server yet ({settings.providerProblem}). You can still upload pages and type records in by hand.</p>
                ) : settings.aiApproved ? (
                  <p className="text-emerald-200">
                    AI reading is on. Page images are sent securely to {settings.provider === "anthropic" ? "Anthropic (Claude)" : settings.provider} to be read{settings.changedBy ? ` — approved by ${settings.changedBy}` : ""}.
                  </p>
                ) : (
                  <p className="text-amber-200">AI reading is off. Pages contain confidential pharmacy and customer information, so they are only sent to the AI provider after your Super Administrator approves it.</p>
                )}
              </div>
            </div>
            {settings.canChange && settings.providerConfigured ? (
              settings.aiApproved ? (
                <ActionButton tone="secondary" disabled={busy} onClick={() => toggleAi(false)}>
                  Turn AI reading off
                </ActionButton>
              ) : (
                <ActionButton disabled={busy} onClick={() => setConsent(true)}>
                  Approve AI reading
                </ActionButton>
              )
            ) : null}
          </div>
          {!category && !consent ? <FormError message={error} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {OPTIONS.map(({ category: value, title, text, icon: Icon }) => (
              <button key={value} type="button" onClick={() => open(value)} className="group flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-left transition hover:border-blue-500/50 hover:bg-slate-900">
                <div className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 group-hover:border-blue-500/40 group-hover:text-blue-300">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-white">{title}</p>
                  <p className="mt-1 text-sm text-slate-400">{text}</p>
                </div>
              </button>
            ))}
            <Link href="/data-migration/scanner/history" className="group flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 transition hover:border-blue-500/50 hover:bg-slate-900 sm:col-span-2">
              <div className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 group-hover:text-blue-300">
                <History className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-white">View Previous Scanning Jobs</p>
                <p className="mt-1 text-sm text-slate-400">Resume an unfinished review, see what was imported and download reports.</p>
              </div>
            </Link>
          </div>

          {recent.length ? (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Recent jobs</p>
              {recent.map((job) => (
                <Link key={job.id} href={`/data-migration/scanner/${encodeURIComponent(job.id)}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm hover:border-slate-700">
                  <span className="text-white">
                    <span className="font-mono text-xs text-slate-400">{job.reference}</span> {job.title}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-slate-400">
                    {job.pages} page(s) · {job.records} record(s)
                    <StatusBadge status={job.statusLabel} tone={JOB_TONES[job.status]} />
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <Modal open={category !== null} title={OPTIONS.find((option) => option.category === category)?.title ?? ""} description="Step 1 of 7: tell us about the pages you are about to scan." onClose={() => setCategory(null)}>
        <div className="space-y-4">
          <Field label="Job name" hint="Optional, e.g. “Stock book 2024, pages 1–20”.">
            <TextInput value={form.title} maxLength={120} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          {category !== "suppliers" || outletChoices.length > 1 ? (
            <Field label="Outlet" hint={category === "suppliers" ? "Suppliers are shared by all outlets." : "The records will be added to this outlet."}>
              <SelectInput value={form.outletId} onChange={(event) => setForm({ ...form, outletId: event.target.value })} options={[...(category === "suppliers" ? [{ value: "", label: "All outlets" }] : []), ...outletChoices.map((outlet) => ({ value: outlet.id, label: `${outlet.name} (${outlet.code})` }))]} />
            </Field>
          ) : null}
          {category === "inventory" ? (
            <fieldset className="space-y-2">
              <legend className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">What do the quantities on these pages mean?</legend>
              {Object.entries(stockModes).map(([value, label]) => (
                <label key={value} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${form.stockMode === value ? "border-blue-500/60 bg-blue-500/10 text-white" : "border-slate-800 text-slate-300"}`}>
                  <input type="radio" name="stockMode" className="mt-1" checked={form.stockMode === value} onChange={() => setForm({ ...form, stockMode: value })} />
                  {label}
                </label>
              ))}
              <p className="text-xs text-slate-500">Stock is never overwritten: quantities are added through the stock ledger as opening stock, one batch per line.</p>
            </fieldset>
          ) : null}
          {category === "sales" ? <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">Historical sales keep their original dates and are marked as migrated records. They do not deduct current stock, take payments or send messages to customers. If you only have daily totals, they are imported as daily totals — individual sales are never made up from them.</p> : null}
          <Field label="Note for the reader (optional)" hint="e.g. “Prices are per carton”, or “Column 3 is the cost price”.">
            <TextInput value={form.note} maxLength={500} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <ActionButton tone="secondary" onClick={() => setCategory(null)}>
              Cancel
            </ActionButton>
            <ActionButton disabled={busy || (category === "inventory" && !form.stockMode)} onClick={create}>
              <Camera className="h-4 w-4" /> Continue to upload
            </ActionButton>
          </div>
        </div>
      </Modal>

      <Modal open={consent} title="Approve AI reading of your documents" onClose={() => setConsent(false)}>
        <div className="space-y-3 text-sm text-slate-300">
          <p>
            Scanned pages can contain confidential pharmacy, patient and customer information. When you approve, page images from this pharmacy are sent over an encrypted connection to <strong className="text-white">{settings?.provider === "anthropic" ? "Anthropic (Claude)" : settings?.provider}</strong>
            {settings?.model ? ` (${settings.model})` : ""} to be read, and the results are stored in PharmaERP for your staff to check.
          </p>
          <p>Only staff with permission can upload pages. Nothing is imported until an authorised person approves each record. You can turn AI reading off at any time.</p>
          {!canApprove ? null : <p className="text-xs text-slate-500">Your approval is recorded in the audit log.</p>}
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <ActionButton tone="secondary" onClick={() => setConsent(false)}>
              Cancel
            </ActionButton>
            <ActionButton disabled={busy} onClick={() => toggleAi(true)}>
              I approve
            </ActionButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
