"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, Notice } from "@/components/auth-card";

const STATUSES = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING_CUSTOMER: "Waiting for the pharmacy", RESOLVED: "Resolved", CLOSED: "Closed" };
const PRIORITIES = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
}

export function TicketControls({ ticketId, status, priority, assignedTo, staff }: { ticketId: string; status: string; priority: string; assignedTo: string | null; staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function update(patch: Record<string, unknown>) {
    setError(null);
    try {
      await send(`/api/platform/tickets/${ticketId}`, "PATCH", patch);
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm" data-ticket-controls>
      <label>Status <select className="rounded-lg border border-slate-300 px-2 py-1" value={status} onChange={(event) => void update({ status: event.target.value })}>{Object.entries(STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Priority <select className="rounded-lg border border-slate-300 px-2 py-1" value={priority} onChange={(event) => void update({ priority: event.target.value })}>{Object.entries(PRIORITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Assigned to <select className="rounded-lg border border-slate-300 px-2 py-1" value={assignedTo ?? ""} onChange={(event) => void update({ assignedTo: event.target.value || null })}><option value="">Nobody</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

export function TicketReply({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [resolve, setResolve] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send(`/api/platform/tickets/${ticketId}`, "POST", { message, internal, ...(resolve && !internal ? { status: "RESOLVED" } : {}) });
      setMessage("");
      setResolve(false);
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-white p-4" data-ticket-reply>
      <textarea required rows={5} className={`${inputClass} h-auto py-2`} placeholder={internal ? "Internal note: only Web365 staff see this" : "Reply to the pharmacy (they get it by email)"} value={message} onChange={(event) => setMessage(event.target.value)} />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Internal note</label>
        {!internal ? <label className="flex items-center gap-1"><input type="checkbox" checked={resolve} onChange={(event) => setResolve(event.target.checked)} /> Mark as resolved</label> : null}
        <button type="submit" disabled={busy} className="ml-auto rounded-lg bg-green-700 px-4 py-2 font-semibold text-white hover:bg-green-800 disabled:opacity-60">{internal ? "Add note" : "Send reply"}</button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </form>
  );
}
