"use client";

import Link from "next/link";
import { useState } from "react";

import { Notice, inputClass } from "@/components/auth-card";

import { LimitsEditor } from "../../ai-console";

type Detail = {
  tenant: { id: string; name: string; status: string };
  wallet: { available: number; reserved: number; purchased: number; free: number; consumed: number; refunded: number; status: string; createdAt: string | null; lastTransactionAt: string | null } | null;
  transactions: { reference: string; typeLabel: string; direction: string; amount: number; availableAfter: number; reservedAfter: number; description: string; operation: string | null; by: string; at: string | null }[];
  purchases: { id: string; reference: string; packageName: string; coins: number; amount: number; fees: number | null; status: string; by: string; createdAt: string | null }[];
  usage: { code: string; requests: number; failed: number; coins: number; cost: number }[];
  staff: { name: string; requests: number; coins: number }[];
  limits: { maxDailyCost: number | null; maxMonthlyCost: number | null; maxJobsPerDay: number | null; maxPagesPerJob: number | null; maxConcurrentJobs: number | null; maxRequestsPerUserPerDay: number | null; paused: boolean } | null;
  overrides: { code: string; name: string; coins: number; enabled: boolean; method: string }[];
};

const n = (value: number) => value.toLocaleString("en-NG");
const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
const button = "inline-flex h-9 items-center justify-center rounded-lg bg-green-700 px-3 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50";

async function post(body: Record<string, unknown>): Promise<Detail> {
  const response = await fetch("/api/platform/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Detail & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Nothing yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500"><tr>{head.map((cell) => <th key={cell} className="px-2 py-2 font-medium">{cell}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className="px-2 py-2 align-top">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function TenantAiDetail({ initial, canManage }: { initial: Detail; canManage: boolean }) {
  const [detail, setDetail] = useState(initial);
  const [adjust, setAdjust] = useState({ coins: "", type: "PROMO_BONUS", reason: "" });
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const w = detail.wallet;
  const run = async (body: Record<string, unknown>, done: string) => {
    try {
      setDetail(await post(body));
      setMessage({ tone: "success", text: done });
    } catch (problem) {
      setMessage({ tone: "error", text: (problem as Error).message });
    }
  };
  return (
    <div className="space-y-5">
      <div>
        <Link href="/platform/ai?tab=tenants" className="text-sm text-green-700 hover:underline">← Pharmacy usage</Link>
        <h1 className="mt-1 text-2xl font-bold">{detail.tenant.name}: AI usage</h1>
        <p className="text-sm text-slate-600">Coins, purchases and AI usage only. Scanned documents and their contents stay private to the pharmacy.</p>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[["Available", w?.available], ["Held", w?.reserved], ["Bought", w?.purchased], ["Free", w?.free], ["Used", w?.consumed], ["Refunded", w?.refunded]].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value === undefined ? "—" : n(Number(value))}</p></div>
        ))}
      </div>
      <p className="text-sm text-slate-600">Wallet {w ? `${w.status.toLowerCase()}, opened ${when(w.createdAt)}, last activity ${when(w.lastTransactionAt)}` : "not opened yet"}.</p>

      {canManage ? (
        <Section title="Adjust coins">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm font-medium">Coins (negative removes)<input className={inputClass} type="number" value={adjust.coins} onChange={(event) => setAdjust({ ...adjust, coins: event.target.value })} /></label>
            <label className="text-sm font-medium">Type<select className={inputClass} value={adjust.type} onChange={(event) => setAdjust({ ...adjust, type: event.target.value })}><option value="PROMO_BONUS">Promotional bonus</option><option value="REFUND">Refund (coins back)</option><option value="ADJUSTMENT">Manual adjustment</option></select></label>
            <label className="text-sm font-medium sm:col-span-2">Reason (shown to the pharmacy)<input className={inputClass} value={adjust.reason} onChange={(event) => setAdjust({ ...adjust, reason: event.target.value })} /></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => run({ action: "adjust", adjustment: { tenantId: detail.tenant.id, coins: Number(adjust.coins), type: adjust.type, reason: adjust.reason } }, "Coins adjusted.")}>Record adjustment</button>
            <button type="button" className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-3 text-sm" onClick={() => { const reason = window.prompt(`Reason for ${w?.status === "SUSPENDED" ? "reactivating" : "suspending"} the wallet`); if (reason) void run({ action: "wallet-status", tenantId: detail.tenant.id, status: w?.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED", reason }, "Wallet status changed."); }}>{w?.status === "SUSPENDED" ? "Reactivate wallet" : "Suspend wallet"}</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Every adjustment is a new ledger entry with your name and reason; nothing is edited or deleted.</p>
        </Section>
      ) : null}

      <Section title="Limits for this pharmacy (blank = platform limit)">
        <LimitsEditor row={{ tenantId: detail.tenant.id, tenantName: detail.tenant.name, maxDailyCost: detail.limits?.maxDailyCost ?? null, maxMonthlyCost: detail.limits?.maxMonthlyCost ?? null, maxJobsPerDay: detail.limits?.maxJobsPerDay ?? null, maxPagesPerJob: detail.limits?.maxPagesPerJob ?? null, maxConcurrentJobs: detail.limits?.maxConcurrentJobs ?? null, maxRequestsPerUserPerDay: detail.limits?.maxRequestsPerUserPerDay ?? null, paused: detail.limits?.paused ?? false, updatedBy: null, updatedAt: null }} canManage={canManage} onSaved={() => setMessage({ tone: "success", text: "Limits saved." })} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Usage by AI operation"><Rows head={["Operation", "Requests", "Failed", "Coins", "Cost (est.)"]} rows={detail.usage.map((row) => [row.code, n(row.requests), n(row.failed), n(row.coins), `$${row.cost.toFixed(4)}`])} /></Section>
        <Section title="Usage by staff member"><Rows head={["Staff", "Requests", "Coins"]} rows={detail.staff.map((row) => [row.name, n(row.requests), n(row.coins)])} /></Section>
      </div>
      {detail.overrides.length ? <Section title="Price overrides"><Rows head={["Operation", "Coins", "Enabled"]} rows={detail.overrides.map((row) => [`${row.name} (${row.code})`, n(row.coins), row.enabled ? "Yes" : "No"])} /></Section> : null}
      <Section title="Coin purchases"><Rows head={["Started", "Package", "Coins", "Amount", "Fee", "Status", "By", "Reference"]} rows={detail.purchases.map((row) => [when(row.createdAt), row.packageName, n(row.coins), `₦${n(row.amount)}`, row.fees === null ? "—" : `₦${n(row.fees)}`, row.status.toLowerCase(), row.by, <span key="r" className="font-mono text-xs">{row.reference}</span>])} /></Section>
      <Section title="Coin ledger (latest 100)"><Rows head={["When", "Type", "Coins", "Balance", "Held", "Description", "By", "Reference"]} rows={detail.transactions.map((row) => [when(row.at), row.typeLabel, `${row.direction === "DEBIT" || row.direction === "HOLD" ? "−" : "+"}${n(row.amount)}`, n(row.availableAfter), n(row.reservedAfter), row.description, row.by, <span key="r" className="font-mono text-xs">{row.reference}</span>])} /></Section>
    </div>
  );
}
