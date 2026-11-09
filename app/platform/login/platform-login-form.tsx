"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { buttonClass, Field, inputClass, Notice } from "@/components/auth-card";
import { preloadRecaptcha, recaptchaToken } from "@/lib/recaptcha-client";

export function PlatformLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => preloadRecaptcha(), []);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError("");
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { error?: string; twoFactor?: boolean; restart?: boolean };
    setBusy(false);
    return { response, result };
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    const { response, result } = await post("/api/platform/login", { email, password, recaptchaToken: await recaptchaToken("platform_login") });
    if (!response.ok) return setError(result.error ?? "Sign-in failed.");
    setPassword("");
    if (result.twoFactor) return setStep("code");
    router.push("/platform");
    router.refresh();
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    const { response, result } = await post("/api/platform/login/verify", { code });
    setCode("");
    if (!response.ok) {
      if (result.restart) setStep("password");
      return setError(result.error ?? "Sign-in failed.");
    }
    router.push("/platform");
    router.refresh();
  }

  if (step === "code") {
    return (
      <form className="space-y-4" onSubmit={submitCode} data-two-factor-step>
        <p className="text-sm text-slate-600">Enter the 6-digit code from your authenticator app. Lost your phone? Enter one of your recovery codes instead.</p>
        <Field label="Code"><input required autoFocus inputMode="numeric" autoComplete="one-time-code" className={inputClass} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <button type="submit" disabled={busy} className={buttonClass}>{busy ? "Checking…" : "Verify"}</button>
        <button type="button" onClick={() => { setStep("password"); setError(""); }} className="w-full text-sm text-slate-600 hover:underline">Start again</button>
      </form>
    );
  }
  return (
    <form className="space-y-4" onSubmit={submitPassword}>
      <Field label="Email"><input required type="email" autoComplete="username" className={inputClass} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      <Field label="Password"><input required type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button type="submit" disabled={busy} className={buttonClass}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
