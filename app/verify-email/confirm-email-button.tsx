"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClass, Notice } from "@/components/auth-card";

/** Confirming takes a click, so email security scanners that open links cannot confirm on the owner's behalf. */
export function ConfirmEmailButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  async function confirm() {
    setState("busy");
    setError("");
    const response = await fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Please try again.");
      setState("idle");
      return;
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <div className="space-y-4">
        <Notice tone="success">Thank you, your email address is confirmed.</Notice>
        <Link href="/dashboard" className={buttonClass}>Continue</Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-center text-slate-600">Press the button to confirm this is your email address.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button type="button" onClick={() => void confirm()} disabled={state === "busy"} className={buttonClass}>{state === "busy" ? "Confirming…" : "Confirm my email"}</button>
    </div>
  );
}
