"use client";

import Link from "next/link";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";

export function AcceptInviteForm({ token, staffId, email, minLength }: { token: string; staffId: string; email: string; minLength: number }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const field = "h-12 w-full rounded-xl border border-slate-300 px-4 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-600/15";

  if (done) {
    return (
      <div className="mt-6 space-y-3 text-center text-sm">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <p>Your account is active. Sign in with <span className="font-semibold">{email}</span> or staff ID <span className="font-mono font-semibold">{staffId}</span>.</p>
        <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-xl bg-green-700 px-6 font-semibold text-white hover:bg-green-800">Go to sign in</Link>
      </div>
    );
  }

  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (password !== confirm) return setError("Passwords do not match.");
        setBusy(true);
        setError(null);
        const response = await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (!response.ok) return setError(payload.error ?? "Could not activate the account.");
        setDone(true);
      }}
    >
      <p className="rounded-xl bg-green-50 px-4 py-2 text-sm text-green-900">Staff ID <span className="font-mono font-semibold">{staffId}</span></p>
      <input type="password" autoComplete="new-password" className={field} placeholder="Choose a password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <input type="password" autoComplete="new-password" className={field} placeholder="Confirm password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      <p className="text-xs text-slate-500">At least {minLength} characters, with upper-case and lower-case letters and a number.</p>
      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p> : null}
      <button type="submit" disabled={busy || !password} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-700 font-semibold text-white hover:bg-green-800 disabled:opacity-60">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Activate account
      </button>
    </form>
  );
}
