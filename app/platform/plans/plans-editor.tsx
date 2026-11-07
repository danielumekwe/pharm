"use client";

import { useState } from "react";

import { Notice, inputClass } from "@/components/auth-card";
import type { PlanConfiguration } from "@/lib/platform/plans";

type Draft = Omit<PlanConfiguration, "monthlyPrice" | "annualPrice" | "maxOutlets" | "maxStaffAccounts" | "features"> & {
  monthlyPrice: string;
  annualPrice: string;
  maxOutlets: string;
  maxStaffAccounts: string;
  featureKeys: string;
  featuresEnabled: boolean;
};

function draftFrom(plan: PlanConfiguration): Draft {
  return {
    ...plan,
    monthlyPrice: plan.monthlyPrice?.toString() ?? "",
    annualPrice: plan.annualPrice?.toString() ?? "",
    maxOutlets: plan.maxOutlets?.toString() ?? "",
    maxStaffAccounts: plan.maxStaffAccounts?.toString() ?? "",
    featureKeys: plan.features?.join("\n") ?? "",
    featuresEnabled: plan.features !== null,
  };
}

function nullableNumber(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Enter a valid number or leave the field blank.");
  return parsed;
}

export function PlansEditor({ plans }: { plans: PlanConfiguration[] }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(plans.map((plan) => [plan.id, draftFrom(plan)])));
  const [messages, setMessages] = useState<Record<string, { tone: "success" | "error"; text: string }>>({});
  const update = (id: string, values: Partial<Draft>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...values } }));

  async function save(id: string) {
    setMessages((current) => ({ ...current, [id]: { tone: "success", text: "Saving…" } }));
    const draft = drafts[id];
    try {
      const response = await fetch(`/api/platform/plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          monthlyPrice: nullableNumber(draft.monthlyPrice),
          annualPrice: nullableNumber(draft.annualPrice),
          currency: draft.currency.trim().toUpperCase(),
          trialDays: Number(draft.trialDays),
          maxOutlets: nullableNumber(draft.maxOutlets),
          maxStaffAccounts: nullableNumber(draft.maxStaffAccounts),
          features: draft.featuresEnabled ? draft.featureKeys.split(/\r?\n/).map((feature) => feature.trim()).filter(Boolean) : null,
          isActive: draft.isActive,
          isPublic: draft.isPublic,
          sortOrder: Number(draft.sortOrder),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update the plan.");
      setMessages((current) => ({ ...current, [id]: { tone: "success", text: "Plan saved." } }));
    } catch (error) {
      setMessages((current) => ({ ...current, [id]: { tone: "error", text: error instanceof Error ? error.message : "Could not update the plan." } }));
    }
  }

  return (
    <div className="space-y-5">
      {plans.map((plan) => {
        const draft = drafts[plan.id];
        return (
          <section key={plan.id} data-plan={plan.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(plan.id); }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">Plan name<input className={inputClass} value={draft.name} onChange={(event) => update(plan.id, { name: event.target.value })} /></label>
                <label className="text-sm font-medium">Currency<input className={inputClass} maxLength={3} value={draft.currency} onChange={(event) => update(plan.id, { currency: event.target.value })} /></label>
                <label className="text-sm font-medium sm:col-span-2">Description<textarea className={inputClass} rows={2} value={draft.description} onChange={(event) => update(plan.id, { description: event.target.value })} /></label>
                <label className="text-sm font-medium">Monthly price<input className={inputClass} type="number" min="0" step="0.0001" value={draft.monthlyPrice} onChange={(event) => update(plan.id, { monthlyPrice: event.target.value })} placeholder="Not set" /></label>
                <label className="text-sm font-medium">Annual price<input className={inputClass} type="number" min="0" step="0.0001" value={draft.annualPrice} onChange={(event) => update(plan.id, { annualPrice: event.target.value })} placeholder="Not set" /></label>
                <label className="text-sm font-medium">Maximum outlets<input className={inputClass} type="number" min="1" step="1" value={draft.maxOutlets} onChange={(event) => update(plan.id, { maxOutlets: event.target.value })} placeholder="Not set" /></label>
                <label className="text-sm font-medium">Maximum staff accounts<input className={inputClass} type="number" min="1" step="1" value={draft.maxStaffAccounts} onChange={(event) => update(plan.id, { maxStaffAccounts: event.target.value })} placeholder="Not set" /></label>
                <label className="text-sm font-medium">Trial days<input className={inputClass} type="number" min="0" max="365" step="1" value={draft.trialDays} onChange={(event) => update(plan.id, { trialDays: Number(event.target.value) })} /></label>
                <label className="text-sm font-medium">Display order<input className={inputClass} type="number" min="0" step="1" value={draft.sortOrder} onChange={(event) => update(plan.id, { sortOrder: Number(event.target.value) })} /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.featuresEnabled} onChange={(event) => update(plan.id, { featuresEnabled: event.target.checked })} />Enforce this feature allowlist</label>
                {draft.featuresEnabled ? (
                  <label className="text-sm font-medium sm:col-span-2">Feature keys (one per line)<textarea className={inputClass} rows={3} value={draft.featureKeys} onChange={(event) => update(plan.id, { featureKeys: event.target.value })} placeholder="stock_transfers&#10;regulatory_management" /><span className="mt-1 block text-xs font-normal text-slate-500">Supported keys: stock_transfers and regulatory_management. An enabled empty list denies both.</span></label>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-5 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.isActive} onChange={(event) => update(plan.id, { isActive: event.target.checked })} />Active</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.isPublic} onChange={(event) => update(plan.id, { isPublic: event.target.checked })} />Shown on registration</label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">Save {draft.name || "plan"}</button>
                {messages[plan.id] ? <Notice tone={messages[plan.id].tone}>{messages[plan.id].text}</Notice> : null}
              </div>
            </form>
          </section>
        );
      })}
    </div>
  );
}
