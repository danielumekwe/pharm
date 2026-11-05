"use client";

import { AlertOctagon, CalendarClock, FileCheck2, FileUp, FileWarning, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DataTable, type Column } from "@/components/erp/data-table";
import { ActionButton, Field, FormError, SelectInput, TextInput } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";
import { PageHeader } from "@/components/erp/page-header";
import { Panel, StatGrid } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { TabBar } from "@/components/erp/tabs";
import { useAction } from "@/components/erp/use-action";
import { dateTime, shortDate } from "@/lib/format";

type Registration = {
  id: string;
  productName: string;
  genericName: string;
  manufacturer: string;
  category: string;
  nafdacNumber: string;
  issuedDate: string;
  expiryDate: string;
  notes?: string;
  updatedBy: string;
  updatedAt: string;
  state: string;
  days: number | null;
  locations: number;
  documents: number;
};
type Licence = { id: string; name: string; code: string; type: string; status: string; pcnLicense: string; licenceExpiry: string; state: string; days: number | null; documents: number };
type Doc = { id: string; title: string; category: string; relatedTo: string; fileName: string; mimeType: string; size: number; expiresOn?: string; uploadedBy: string; uploadedAt: string };

const STATE_TONES: Record<string, "emerald" | "amber" | "rose" | "slate"> = { Valid: "emerald", "Renewal due": "amber", Expired: "rose", Pending: "slate" };
const daysLabel = (days: number | null) => (days === null ? "" : days < 0 ? `${-days}d overdue` : `${days}d left`);

export function RegulatoryWorkspace({
  registrations,
  licences,
  documents,
  categories,
  relatedOptions,
  expiredBatches,
  renewalWindow,
  canManage,
}: {
  registrations: Registration[];
  licences: Licence[];
  documents: Doc[];
  categories: string[];
  relatedOptions: { value: string; label: string }[];
  expiredBatches: number;
  renewalWindow: number;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Registration | null>(null);
  const [licence, setLicence] = useState<Licence | null>(null);
  const [uploading, setUploading] = useState(false);
  const { run, error } = useAction();
  const relatedLabel = (value: string) => relatedOptions.find((option) => option.value === value)?.label.replace(/^(Outlet|Product): /, "") ?? (value || "—");

  const registrationColumns: Column<Registration>[] = [
    { key: "product", header: "Product", value: (row) => row.productName, render: (row) => <div><p className="text-white">{row.productName}</p><p className="text-[11px] text-slate-500">{row.genericName} · {row.manufacturer}</p></div> },
    { key: "category", header: "Class", value: (row) => row.category, render: (row) => row.category },
    { key: "nafdac", header: "NAFDAC no.", value: (row) => row.nafdacNumber, render: (row) => <span className="font-mono text-xs">{row.nafdacNumber}</span> },
    { key: "issued", header: "Issued", value: (row) => row.issuedDate, render: (row) => <span className="text-slate-400">{row.issuedDate ? shortDate(row.issuedDate) : "—"}</span> },
    { key: "expiry", header: "Expires", value: (row) => row.expiryDate, render: (row) => (row.expiryDate ? <span className={row.state === "Expired" ? "text-rose-300" : row.state === "Renewal due" ? "text-amber-300" : ""}>{shortDate(row.expiryDate)} <span className="text-[11px] text-slate-500">{daysLabel(row.days)}</span></span> : "—") },
    { key: "state", header: "Status", value: (row) => row.state, render: (row) => <StatusBadge status={row.state} tone={STATE_TONES[row.state]} /> },
    { key: "docs", header: "Docs", value: (row) => row.documents, align: "right", render: (row) => row.documents },
    { key: "edit", header: "", render: (row) => (canManage ? <button type="button" onClick={() => setEditing(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`Edit ${row.productName}`}><Pencil className="h-4 w-4" /></button> : null) },
  ];

  const licenceColumns: Column<Licence>[] = [
    { key: "outlet", header: "Premises", value: (row) => row.name, render: (row) => <div><p className="text-white">{row.name}</p><p className="text-[11px] text-slate-500">{row.code} · {row.type === "WAREHOUSE" ? "Wholesale / warehouse" : "Retail pharmacy"}{row.status === "CLOSED" ? " · closed" : ""}</p></div> },
    { key: "licence", header: "PCN licence", value: (row) => row.pcnLicense, render: (row) => <span className="font-mono text-xs">{row.pcnLicense}</span> },
    { key: "expiry", header: "Expires", value: (row) => row.licenceExpiry, render: (row) => (row.licenceExpiry ? <span className={row.state === "Expired" ? "text-rose-300" : row.state === "Renewal due" ? "text-amber-300" : ""}>{shortDate(row.licenceExpiry)} <span className="text-[11px] text-slate-500">{daysLabel(row.days)}</span></span> : "—") },
    { key: "state", header: "Status", value: (row) => row.state, render: (row) => <StatusBadge status={row.state} tone={STATE_TONES[row.state]} /> },
    { key: "docs", header: "Docs", value: (row) => row.documents, align: "right", render: (row) => row.documents },
    { key: "edit", header: "", render: (row) => (canManage ? <button type="button" onClick={() => setLicence(row)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`Edit ${row.name} licence`}><Pencil className="h-4 w-4" /></button> : null) },
  ];

  const documentColumns: Column<Doc>[] = [
    { key: "title", header: "Document", value: (row) => row.title, render: (row) => <div><a href={`/api/regulatory/documents/${row.id}`} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">{row.title}</a><p className="text-[11px] text-slate-500">{row.fileName} · {Math.ceil(row.size / 1024)} KB</p></div> },
    { key: "category", header: "Category", value: (row) => row.category, render: (row) => row.category },
    { key: "related", header: "Relates to", value: (row) => relatedLabel(row.relatedTo), render: (row) => relatedLabel(row.relatedTo) },
    { key: "expires", header: "Valid until", value: (row) => row.expiresOn ?? "", render: (row) => (row.expiresOn ? shortDate(row.expiresOn) : "—") },
    { key: "by", header: "Uploaded", value: (row) => row.uploadedAt, render: (row) => <span className="text-xs text-slate-400">{dateTime(row.uploadedAt)} · {row.uploadedBy}</span> },
    {
      key: "delete",
      header: "",
      render: (row) =>
        canManage ? (
          <button type="button" aria-label={`Delete ${row.title}`} onClick={async () => { if (window.confirm(`Delete "${row.title}"? This is recorded in the audit trail.`)) await run(`/api/regulatory/documents/${row.id}`, "DELETE"); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300">
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  const due = registrations.filter((row) => row.state === "Renewal due").length + licences.filter((row) => row.state === "Renewal due").length;
  const expired = registrations.filter((row) => row.state === "Expired").length + licences.filter((row) => row.state === "Expired").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Regulatory affairs"
        title="Registrations, licences & documents"
        description={`NAFDAC product registrations and PCN premises licences across all outlets. Renewals are flagged ${renewalWindow} days before expiry. Every change and upload is audited.`}
        actions={canManage ? <ActionButton onClick={() => setUploading(true)}><FileUp className="h-4 w-4" /> Upload document</ActionButton> : null}
      />

      <StatGrid
        stats={[
          { label: "Registered products", value: `${registrations.filter((row) => row.state !== "Pending").length} / ${registrations.length}`, note: `${registrations.filter((row) => row.state === "Pending").length} awaiting NAFDAC approval`, icon: FileCheck2, tone: "emerald" },
          { label: "Renewals due", value: String(due), note: `Within ${renewalWindow} days`, icon: CalendarClock, tone: "amber" },
          { label: "Expired", value: String(expired), note: "Registrations or licences — stop sale / operation", icon: AlertOctagon, tone: "rose" },
          { label: "Documents on file", value: String(documents.length), note: `${expiredBatches} expired stock batch(es) pending destruction`, icon: FileWarning, tone: "sky" },
        ]}
      />

      <FormError message={error} />

      <Panel title="Regulatory register">
        <TabBar
          tabs={[
            { key: "products", label: "Product registrations", count: registrations.length, content: <DataTable rows={registrations} columns={registrationColumns} rowKey={(row) => row.id} search={(row) => `${row.productName} ${row.genericName} ${row.nafdacNumber} ${row.manufacturer}`} filters={[{ key: "state", label: "Statuses", options: ["Valid", "Renewal due", "Expired", "Pending"].map((value) => ({ value, label: value })), get: (row) => row.state }]} exportName="nafdac-registrations" /> },
            { key: "licences", label: "Premises licences", count: licences.length, content: <DataTable rows={licences} columns={licenceColumns} rowKey={(row) => row.id} exportName="pcn-licences" /> },
            { key: "documents", label: "Documents", count: documents.length, content: <DataTable rows={documents} columns={documentColumns} rowKey={(row) => row.id} search={(row) => `${row.title} ${row.category} ${row.fileName}`} filters={[{ key: "category", label: "Categories", options: categories.map((value) => ({ value, label: value })), get: (row) => row.category }]} emptyMessage="No documents uploaded yet." exportName="regulatory-documents" /> },
          ]}
        />
      </Panel>

      {editing ? <RegistrationModal registration={editing} onClose={() => setEditing(null)} /> : null}
      {licence ? <LicenceModal licence={licence} onClose={() => setLicence(null)} /> : null}
      {uploading ? <UploadModal categories={categories} relatedOptions={relatedOptions} onClose={() => setUploading(false)} /> : null}
    </div>
  );
}

function RegistrationModal({ registration, onClose }: { registration: Registration; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({ nafdacNumber: registration.nafdacNumber === "Pending" ? "" : registration.nafdacNumber, issuedDate: registration.issuedDate, expiryDate: registration.expiryDate, notes: registration.notes ?? "" });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Modal open title={`Registration: ${registration.productName}`} description={`Applies to all ${registration.locations} location record(s). Last updated by ${registration.updatedBy}.`} onClose={onClose}>
      <div className="grid gap-3">
        <Field label="NAFDAC registration no." hint="Leave blank while the application is pending"><TextInput value={form.nafdacNumber} onChange={set("nafdacNumber")} placeholder="A4-12345" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issued"><TextInput type="date" value={form.issuedDate} onChange={set("issuedDate")} /></Field>
          <Field label="Expires"><TextInput type="date" value={form.expiryDate} onChange={set("expiryDate")} /></Field>
        </div>
        <Field label="Notes"><TextInput value={form.notes} onChange={set("notes")} placeholder="e.g. Renewal filed 12 Oct 2026, ref NAF/RN/2231" /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy} onClick={async () => (await run(`/api/regulatory/registrations/${registration.id}`, "PATCH", form)) && onClose()}>Save registration</ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function LicenceModal({ licence, onClose }: { licence: Licence; onClose: () => void }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({ pcnLicense: licence.pcnLicense === "Pending" ? "" : licence.pcnLicense, licenceExpiry: licence.licenceExpiry });
  return (
    <Modal open title={`Premises licence: ${licence.name}`} description="Pharmacists Council of Nigeria premises registration." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Licence number"><TextInput value={form.pcnLicense} onChange={(event) => setForm((current) => ({ ...current, pcnLicense: event.target.value }))} placeholder="PCN/PR/LA/2026/1182" /></Field>
        <Field label="Expires"><TextInput type="date" value={form.licenceExpiry} onChange={(event) => setForm((current) => ({ ...current, licenceExpiry: event.target.value }))} /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy} onClick={async () => (await run(`/api/regulatory/licences/${licence.id}`, "PATCH", form)) && onClose()}>Save licence</ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function UploadModal({ categories, relatedOptions, onClose }: { categories: string[]; relatedOptions: { value: string; label: string }[]; onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ title: "", category: categories[0], relatedTo: "", expiresOn: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a file.");
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    data.append("file", file);
    setBusy(true);
    setError(null);
    const response = await fetch("/api/regulatory/documents", { method: "POST", body: data });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) return setError(payload.error ?? "Upload failed.");
    router.refresh();
    onClose();
  }

  return (
    <Modal open title="Upload regulatory document" description="PDF, PNG or JPEG up to 5 MB. Stored privately; only users with regulatory access can open it." onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Title"><TextInput value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. NAFDAC certificate — Amoxicillin 250mg" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><SelectInput value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} options={categories.map((value) => ({ value, label: value }))} /></Field>
          <Field label="Valid until (optional)"><TextInput type="date" value={form.expiresOn} onChange={(event) => setForm((current) => ({ ...current, expiresOn: event.target.value }))} /></Field>
        </div>
        <Field label="Relates to"><SelectInput value={form.relatedTo} onChange={(event) => setForm((current) => ({ ...current, relatedTo: event.target.value }))} options={[{ value: "", label: "General / not linked" }, ...relatedOptions]} /></Field>
        <Field label="File"><input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[#fff]" /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <ActionButton tone="secondary" onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy || form.title.trim().length < 3} onClick={() => void upload()}><FileUp className="h-4 w-4" /> {busy ? "Uploading…" : "Upload"}</ActionButton>
        </div>
      </div>
    </Modal>
  );
}
