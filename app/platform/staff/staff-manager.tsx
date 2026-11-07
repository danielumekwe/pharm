"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, Notice } from "@/components/auth-card";

type Member = { id: string; name: string; email: string; role: string; roleLabel: string; status: string; last_login_at: string | null };

export function StaffManager({ staff, selfId }: { staff: Member[]; selfId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", role: "PLATFORM_SUPPORT" });
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/platform/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const body = (await response.json().catch(() => ({}))) as { error?: string; temporaryPassword?: string };
    if (!response.ok) return setMessage({ tone: "error", text: body.error ?? "Could not create the account." });
    setMessage({ tone: "success", text: `Created. Temporary password (shown once, share it securely): ${body.temporaryPassword}` });
    setForm({ name: "", email: "", role: "PLATFORM_SUPPORT" });
    router.refresh();
  }
  async function setStatus(id: string, status: string) {
    const response = await fetch(`/api/platform/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return setMessage({ tone: "error", text: body.error ?? "Could not update." });
    router.refresh();
  }
  return (
    <div className="mt-4 space-y-4">
      <form onSubmit={create} className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <input required placeholder="Full name" className={`${inputClass} flex-1`} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input required type="email" placeholder="Email" className={`${inputClass} flex-1`} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <select className={`${inputClass} w-56`} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="PLATFORM_SUPPORT">Platform Support</option><option value="BILLING_ADMIN">Billing Administrator</option><option value="TECHNICAL_ADMIN">Technical Administrator</option><option value="PLATFORM_SUPER_ADMIN">Platform Super Admin</option></select>
        <button type="submit" className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white">Add</button>
      </form>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {staff.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span><strong>{member.name}</strong> · {member.email} · {member.roleLabel} · <span className="text-xs uppercase">{member.status}</span>{member.last_login_at ? ` · last sign-in ${member.last_login_at.slice(0, 10)}` : ""}</span>
            {member.id !== selfId ? <button type="button" onClick={() => void setStatus(member.id, member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">{member.status === "ACTIVE" ? "Suspend" : "Reactivate"}</button> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
