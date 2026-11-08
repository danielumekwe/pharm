"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function send(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json().catch(() => ({}))) as { error?: string; ticket?: { id: string } };
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result;
}
const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function NewTicket({ categories }: { categories: { value: string; label: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ category: "QUESTION", subject: "", message: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await send("/api/support/tickets", form);
      router.push(`/support/${result.ticket!.id}`);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" data-new-ticket>
      <label className="text-sm"><span className="mb-1 block font-medium">What is it about?</span><select className={field} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
      <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Subject</span><input required minLength={5} maxLength={140} className={field} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label>
      <label className="text-sm sm:col-span-3"><span className="mb-1 block font-medium">Details</span><textarea required minLength={10} maxLength={5000} rows={5} className={field} placeholder="What happened, what you expected, and which outlet or screen it was on." value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></label>
      {error ? <p role="alert" className="text-sm text-rose-600 sm:col-span-3">{error}</p> : null}
      <div className="sm:col-span-3"><button type="submit" disabled={busy} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">Send to Web365</button></div>
    </form>
  );
}

export function TicketReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await send(`/api/support/tickets/${ticketId}`, { message });
      setMessage("");
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2" data-ticket-reply>
      <textarea required rows={4} maxLength={5000} className={field} value={message} onChange={(event) => setMessage(event.target.value)} />
      {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
      <button type="submit" className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">Send reply</button>
    </form>
  );
}
