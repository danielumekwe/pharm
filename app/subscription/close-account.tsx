"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Closure = { status: string; requestedAt: string; reason: string; decidedAt: string | null; note: string | null } | null;

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** The Super Admin can ask Web365 to close the pharmacy. Nothing changes until Web365 approves. */
export function CloseAccount({ pharmacy, request }: { pharmacy: string; request: Closure }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = request?.status === "REQUESTED";

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/tenant/closure", { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ reason, password }) : undefined });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setPassword("");
    if (!response.ok) return setError(result.error ?? "Something went wrong.");
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-rose-200 bg-white p-5" data-close-account>
      <h2 className="font-semibold text-rose-800">Close this pharmacy&apos;s account</h2>
      {waiting ? (
        <>
          <p className="mt-1 text-sm text-slate-700">You asked Web365 to close {pharmacy} on {day(request.requestedAt)}. Until Web365 acts on it, everything keeps working and you can withdraw the request.</p>
          {error ? <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p> : null}
          <button type="button" disabled={busy} onClick={() => void send("DELETE")} className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">Withdraw the request</button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-700">Web365 reviews the request, then closes the account: nobody can sign in afterwards. The data is kept for a period and then may be deleted.</p>
          {request?.status === "REJECTED" ? <p className="mt-2 text-sm text-slate-600">Your last request was declined on {day(request.decidedAt ?? request.requestedAt)}: {request.note}</p> : null}
          {open ? (
            <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void send("POST"); }}>
              <label className="block text-sm"><span className="mb-1 block font-medium">Why do you want to close the account?</span><textarea required minLength={5} maxLength={600} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="block text-sm"><span className="mb-1 block font-medium">Your password</span><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-60">Send the request to Web365</button>
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Ask to close the account…</button>
          )}
        </>
      )}
    </section>
  );
}
