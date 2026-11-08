"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClass, Field, inputClass, Notice } from "@/components/auth-card";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/auth/password/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    setBusy(false);
    setMessage(response.ok ? { tone: "success", text: body.message ?? "Check your email." } : { tone: "error", text: body.error ?? "Please try again." });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Email address"><input required type="email" autoComplete="email" className={inputClass} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <button type="submit" disabled={busy} className={buttonClass}>{busy ? "Sending…" : "Send reset link"}</button>
      <p className="text-center text-sm text-slate-600">
        Staff without an email? Your pharmacy&apos;s Super Admin can reset your password. <Link href="/login" className="font-medium text-green-700 hover:underline">Back to sign in</Link>
      </p>
    </form>
  );
}
