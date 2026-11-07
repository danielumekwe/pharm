"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { buttonClass, Field, inputClass, Notice } from "@/components/auth-card";

export function PlatformLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/platform/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) return setError(body.error ?? "Sign-in failed.");
    router.push("/platform");
    router.refresh();
  }
  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Email"><input required type="email" autoComplete="username" className={inputClass} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      <Field label="Password"><input required type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button type="submit" disabled={busy} className={buttonClass}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
