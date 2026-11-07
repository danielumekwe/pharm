"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClass, Notice } from "@/components/auth-card";

export function JoinButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  async function join() {
    setState("busy");
    const response = await fetch("/api/auth/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
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
        <Notice tone="success">You have joined. Sign in and choose the pharmacy to work in.</Notice>
        <Link href="/" className={buttonClass}>Go to sign in</Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button type="button" disabled={state === "busy"} onClick={() => void join()} className={buttonClass}>{state === "busy" ? "Joining…" : "Accept and join"}</button>
    </div>
  );
}
