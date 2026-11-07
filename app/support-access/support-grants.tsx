"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Grant = { id: string; status: string; reason: string; minutes: number; requester: string; requestedAt: string; expiresAt: string | null };

const tone: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800", APPROVED: "bg-green-100 text-green-800", DENIED: "bg-slate-100 text-slate-600", REVOKED: "bg-rose-100 text-rose-700", EXPIRED: "bg-slate-100 text-slate-600",
};
const when = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function SupportGrants({ grants, canDecide }: { grants: Grant[]; canDecide: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(grantId: string, decision: "APPROVED" | "DENIED" | "REVOKED") {
    setBusy(grantId);
    setError("");
    const response = await fetch("/api/support-access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grantId, decision }) });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) return setError(body.error ?? "Could not save the decision.");
    router.refresh();
  }

  if (grants.length === 0) return <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Web365 has never asked for access to this pharmacy.</p>;
  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {grants.map((grant) => (
        <article key={grant.id} data-grant={grant.id} data-status={grant.status} className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">{grant.requester} <span className="font-normal text-slate-500">asked for {grant.minutes} minutes of read-only access</span></p>
              <p className="mt-1 text-sm text-slate-700">“{grant.reason}”</p>
              <p className="mt-1 text-xs text-slate-500">Asked {when(grant.requestedAt)}{grant.expiresAt ? ` · ${grant.status === "APPROVED" ? "ends" : "ended"} ${when(grant.expiresAt)}` : ""}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone[grant.status] ?? tone.DENIED}`}>{grant.status.toLowerCase()}</span>
          </div>
          {canDecide && (grant.status === "PENDING" || grant.status === "APPROVED") ? (
            <div className="mt-4 flex gap-2">
              {grant.status === "PENDING" ? (
                <>
                  <button type="button" disabled={busy === grant.id} onClick={() => void decide(grant.id, "APPROVED")} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">Approve</button>
                  <button type="button" disabled={busy === grant.id} onClick={() => void decide(grant.id, "DENIED")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Deny</button>
                </>
              ) : (
                <button type="button" disabled={busy === grant.id} onClick={() => void decide(grant.id, "REVOKED")} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">End access now</button>
              )}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
