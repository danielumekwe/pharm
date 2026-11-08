"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Article = { id: string; slug: string; title: string; category: string; body: string; published: boolean; sortOrder: number; updatedAt: string; updatedBy: string | null };

export function ArticleEditor({ article }: { article: Article | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ slug: article?.slug ?? "", title: article?.title ?? "", category: article?.category ?? "Getting started", body: article?.body ?? "", published: article?.published ?? false, sortOrder: article?.sortOrder ?? 0 });
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function call(method: string, body?: unknown) {
    const response = await fetch(article ? `/api/platform/articles/${article.id}` : "/api/platform/articles", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await call(article ? "PUT" : "POST", form);
      setMessage({ tone: "success", text: "Saved." });
      if (!article) setForm({ slug: "", title: "", category: "Getting started", body: "", published: false, sortOrder: 0 });
      router.refresh();
    } catch (failure) {
      setMessage({ tone: "error", text: (failure as Error).message });
    }
  }
  async function remove() {
    if (!window.confirm(`Delete "${article?.title}"?`)) return;
    try {
      await call("DELETE");
      router.refresh();
    } catch (failure) {
      setMessage({ tone: "error", text: (failure as Error).message });
    }
  }
  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" data-article={article?.slug ?? "new"}>
        {article ? <span><strong>{article.title}</strong> · {article.category} · {article.published ? <span className="text-green-700">published</span> : <span className="text-slate-500">draft</span>} · /help/{article.slug}</span> : <span className="font-semibold">New article</span>}
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold">{article ? "Edit" : "Write one"}</button>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3" data-article-editor>
      <Field label="Title"><input required className={inputClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value, slug: article ? form.slug : event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) })} /></Field>
      <Field label="Address (/help/…)"><input required className={inputClass} value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></Field>
      <Field label="Category"><input required className={inputClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></Field>
      <div className="sm:col-span-3"><Field label="Text"><textarea required rows={10} className={`${inputClass} h-auto py-2 font-mono text-sm`} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></Field></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(event) => setForm({ ...form, published: event.target.checked })} /> Published (pharmacies can see it)</label>
      <Field label="Order in its category"><input type="number" min={0} className={inputClass} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></Field>
      {message ? <div className="sm:col-span-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <div className="flex gap-2 sm:col-span-3">
        <button type="submit" className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Close</button>
        {article ? <button type="button" onClick={() => void remove()} className="ml-auto rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700">Delete</button> : null}
      </div>
    </form>
  );
}
