"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Audience = { type: "all" } | { type: "plans" | "statuses" | "tenants"; ids: string[] };
type Announcement = { id: string; title: string; body: string; severity: string; audience: Audience; status: string; startsAt: string | null; endsAt: string | null; emailOwners: boolean; emailedAt: string | null; createdBy: string; publishedAt: string | null; reads: number };
const STATUSES = ["TRIAL", "ACTIVE", "GRACE", "PAST_DUE", "EXPIRED", "CANCELLED", "SUSPENDED"];
const TONE: Record<string, string> = { info: "border-sky-200 bg-sky-50", warning: "border-amber-300 bg-amber-50", critical: "border-rose-300 bg-rose-50" };

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result;
}

export function AnnouncementEditor({ plans, tenants }: { plans: { id: string; name: string }[]; tenants: { id: string; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", body: "", severity: "info", startsAt: "", endsAt: "", emailOwners: false });
  const [audience, setAudience] = useState<Audience>({ type: "all" });
  const [reach, setReach] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const options = audience.type === "plans" ? plans : audience.type === "tenants" ? tenants : audience.type === "statuses" ? STATUSES.map((id) => ({ id, name: id.replace("_", " ").toLowerCase() })) : [];
  const toggle = (id: string) => audience.type !== "all" && setAudience({ ...audience, ids: audience.ids.includes(id) ? audience.ids.filter((entry) => entry !== id) : [...audience.ids, id] });
  async function preview() {
    try {
      setReach((await send("/api/platform/announcements/audience", "POST", audience)).pharmacies as number);
    } catch (failure) {
      setMessage({ tone: "error", text: (failure as Error).message });
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await send("/api/platform/announcements", "POST", { ...form, audience, startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null, endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null });
      setForm({ title: "", body: "", severity: "info", startsAt: "", endsAt: "", emailOwners: false });
      setAudience({ type: "all" });
      setMessage({ tone: "success", text: "Saved as a draft. Publish it below." });
      router.refresh();
    } catch (failure) {
      setMessage({ tone: "error", text: (failure as Error).message });
    }
  }
  return (
    <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2" data-announcement-editor>
      <Field label="Title"><input required className={inputClass} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
      <Field label="Type"><select className={inputClass} value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Critical</option></select></Field>
      <div className="sm:col-span-2"><Field label="Message"><textarea required rows={3} maxLength={2000} className={`${inputClass} h-auto py-2`} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></Field></div>
      <div className="text-sm sm:col-span-2">
        <span className="mb-1 block font-medium">Who sees it</span>
        <div className="flex flex-wrap gap-3">{(["all", "plans", "statuses", "tenants"] as const).map((type) => <label key={type} className="flex items-center gap-1"><input type="radio" checked={audience.type === type} onChange={() => { setAudience(type === "all" ? { type } : { type, ids: [] }); setReach(null); }} />{type === "all" ? "All pharmacies" : type === "plans" ? "By plan" : type === "statuses" ? "By subscription status" : "Chosen pharmacies"}</label>)}</div>
        {audience.type !== "all" ? <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">{options.map((option) => <label key={option.id} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5"><input type="checkbox" checked={audience.ids.includes(option.id)} onChange={() => toggle(option.id)} />{option.name}</label>)}</div> : null}
        <button type="button" onClick={() => void preview()} className="mt-2 text-xs font-semibold text-green-800 hover:underline">How many pharmacies is that?</button>{reach !== null ? <span className="ml-2 text-xs" data-audience-size>{reach} active pharmacies</span> : null}
      </div>
      <Field label="Show from (optional)"><input type="datetime-local" className={inputClass} value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></Field>
      <Field label="Show until (optional)"><input type="datetime-local" className={inputClass} value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.emailOwners} onChange={(event) => setForm({ ...form, emailOwners: event.target.checked })} /> Also email each pharmacy&apos;s Super Admins when it is published</label>
      {message ? <div className="sm:col-span-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <div className="sm:col-span-2"><button type="submit" className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800">Save draft</button></div>
    </form>
  );
}

export function AnnouncementRow({ announcement }: { announcement: Announcement }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function act(action: "publish" | "archive") {
    if (action === "publish" && !window.confirm(announcement.emailOwners ? "Publish and email the Super Admins of every pharmacy it is for?" : "Publish it now?")) return;
    setError(null);
    try {
      await send(`/api/platform/announcements/${announcement.id}`, "POST", { action });
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  const audience = announcement.audience.type === "all" ? "all pharmacies" : `${announcement.audience.type}: ${announcement.audience.ids.length} chosen`;
  const day = (iso: string | null) => (iso ? iso.replace("T", " ").slice(0, 16) : null);
  return (
    <div className={`rounded-2xl border p-4 text-sm ${TONE[announcement.severity]}`} data-announcement={announcement.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{announcement.title} <span className="ml-1 rounded bg-white px-1.5 text-xs font-normal">{announcement.status.toLowerCase()}</span></p>
          <p className="mt-1 whitespace-pre-wrap">{announcement.body}</p>
          <p className="mt-1 text-xs text-slate-600">For {audience}{day(announcement.startsAt) ? ` · from ${day(announcement.startsAt)}` : ""}{day(announcement.endsAt) ? ` · until ${day(announcement.endsAt)}` : ""} · by {announcement.createdBy}{announcement.publishedAt ? ` · published ${day(announcement.publishedAt)}` : ""}{announcement.emailOwners ? (announcement.emailedAt ? " · emailed" : " · will be emailed") : ""} · dismissed by {announcement.reads}</p>
        </div>
        <div className="flex gap-2">
          {announcement.status === "DRAFT" ? <button type="button" onClick={() => void act("publish")} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white" data-publish>Publish</button> : null}
          {announcement.status !== "ARCHIVED" ? <button type="button" onClick={() => void act("archive")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold">Archive</button> : null}
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
