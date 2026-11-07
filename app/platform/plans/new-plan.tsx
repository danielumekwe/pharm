"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Notice, inputClass } from "@/components/auth-card";

/** Creates a plan, hidden from registration until it is configured and made public. */
export function NewPlan({ nextOrder }: { nextOrder: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/platform/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, plan: { name, description: "", monthlyPrice: null, annualPrice: null, currency: "NGN", trialDays: 14, maxOutlets: null, maxStaffAccounts: null, features: null, isActive: true, isPublic: false, sortOrder: nextOrder } }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return setError(result.error ?? "Could not create the plan.");
    setOpen(false);
    setId("");
    setName("");
    router.refresh();
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white" data-new-plan>New plan</button>;
  return (
    <form onSubmit={create} className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-3" data-new-plan-form>
      <label className="text-sm font-medium">Plan id (permanent)<input className={inputClass} value={id} placeholder="e.g. clinic" onChange={(event) => setId(event.target.value.toLowerCase())} /></label>
      <label className="text-sm font-medium">Name<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div className="flex items-end gap-2">
        <button type="submit" className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white">Create</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button>
      </div>
      <p className="text-xs text-slate-500 sm:col-span-3">The plan starts hidden from registration. Set its prices and limits below, then tick “Shown on registration”.</p>
      {error ? <div className="sm:col-span-3"><Notice tone="error">{error}</Notice></div> : null}
    </form>
  );
}
