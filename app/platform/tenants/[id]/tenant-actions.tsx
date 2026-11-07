"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, Notice } from "@/components/auth-card";

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; url?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

export function TenantActions({ tenantId, status, subscription }: { tenantId: string; status: string; subscription: string | null }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(14);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = async (body: unknown, done: string) => {
    setMessage(null);
    try {
      await call(`/api/platform/tenants/${tenantId}`, "PATCH", body);
      setMessage({ tone: "success", text: done });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  };
  return (
    <section className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
      <div>
        <h2 className="font-semibold">{status === "SUSPENDED" ? "Reactivate" : "Suspend"} pharmacy</h2>
        {status === "SUSPENDED" ? (
          <button type="button" onClick={() => void run({ action: "reactivate" }, "Reactivated.")} className="mt-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white">Reactivate</button>
        ) : (
          <div className="mt-2 flex gap-2">
            <input className={inputClass} placeholder="Reason (shown to its users)" value={reason} onChange={(event) => setReason(event.target.value)} />
            <button type="button" onClick={() => void run({ action: "suspend", reason }, "Suspended.")} className="shrink-0 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white">Suspend</button>
          </div>
        )}
      </div>
      {subscription === "TRIAL" || subscription === "EXPIRED" ? (
        <div>
          <h2 className="font-semibold">Extend trial</h2>
          <div className="mt-2 flex gap-2">
            <input type="number" min={1} max={90} className={inputClass} value={days} onChange={(event) => setDays(Number(event.target.value))} />
            <button type="button" onClick={() => void run({ action: "extend-trial", days }, "Trial extended.")} className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Extend</button>
          </div>
        </div>
      ) : null}
      {message ? <div className="sm:col-span-2"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
    </section>
  );
}

type Grant = { id: string; status: string; reason: string; minutes: number; requester: string; requestedAt: string; expiresAt: string | null };

export function SupportRequests({ tenantId, grants, canRequest }: { tenantId: string; grants: Grant[]; canRequest: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function request() {
    setMessage(null);
    try {
      await call(`/api/platform/tenants/${tenantId}/support`, "POST", { reason, minutes });
      setMessage({ tone: "success", text: "Asked. The pharmacy's Super Admin decides; you can open the session once it is approved." });
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  }
  async function open(grantId: string) {
    try {
      const { url } = await call(`/api/platform/support/${grantId}/open`, "POST");
      window.location.assign(url ?? "/dashboard");
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    }
  }
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Support access</h2>
      <p className="text-sm text-slate-600">Read-only, time-limited, approved by the pharmacy, and recorded in both audit trails.</p>
      {canRequest ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className={`${inputClass} flex-1`} placeholder="Why do you need access? (the pharmacy sees this)" value={reason} onChange={(event) => setReason(event.target.value)} />
          <select className={`${inputClass} w-36`} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[15, 30, 60, 120, 240, 480].map((value) => <option key={value} value={value}>{value} min</option>)}</select>
          <button type="button" onClick={() => void request()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Ask for access</button>
        </div>
      ) : null}
      {message ? <div className="mt-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {grants.map((grant) => (
          <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-grant={grant.id} data-status={grant.status}>
            <span><strong>{grant.requester}</strong> · {grant.minutes} min · “{grant.reason}” · <span className="uppercase text-xs font-semibold">{grant.status}</span>{grant.expiresAt ? ` · until ${grant.expiresAt.replace("T", " ").slice(0, 16)} UTC` : ""}</span>
            {grant.status === "APPROVED" ? <button type="button" onClick={() => void open(grant.id)} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950">Open read-only session</button> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
