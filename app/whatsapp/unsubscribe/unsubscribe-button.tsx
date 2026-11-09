"use client";

import { useState } from "react";

import { buttonClass, Notice } from "@/components/auth-card";

export function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function optOut() {
    setBusy(true);
    const response = await fetch("/api/whatsapp/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token }) });
    const result = (await response.json().catch(() => ({}))) as { pharmacy?: string; error?: string };
    setBusy(false);
    setState(response.ok ? { tone: "success", text: `Done. ${result.pharmacy ?? "The pharmacy"} will not send you WhatsApp messages through PharmaERP any more.` } : { tone: "error", text: result.error ?? "Please try again later." });
  }
  if (state?.tone === "success") return <Notice tone="success">{state.text}</Notice>;
  return (
    <div className="space-y-3">
      {state ? <Notice tone="error">{state.text}</Notice> : null}
      <button type="button" disabled={busy} onClick={() => void optOut()} className={buttonClass} data-unsubscribe>{busy ? "Working…" : "Stop WhatsApp messages"}</button>
    </div>
  );
}
