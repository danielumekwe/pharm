"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClass, Field, inputClass, Notice } from "@/components/auth-card";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    const response = await fetch("/api/auth/password/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) return setError(body.error ?? "Please try again.");
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Notice tone="success">Your password has been changed. Sign in with your new password.</Notice>
        <Link href="/" className={buttonClass}>Go to sign in</Link>
      </div>
    );
  }
  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="New password" hint="At least 8 characters, with letters and a number."><input required type="password" minLength={8} autoComplete="new-password" className={inputClass} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      <Field label="Confirm new password"><input required type="password" autoComplete="new-password" className={inputClass} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button type="submit" disabled={busy} className={buttonClass}>{busy ? "Saving…" : "Set new password"}</button>
    </form>
  );
}
