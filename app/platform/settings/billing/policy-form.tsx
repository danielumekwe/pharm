"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, inputClass, Notice } from "@/components/auth-card";

type Policy = { graceDays: number; refundApproval: "two_person" | "single"; closedRetentionDays: number };

export function PolicyForm({ value: initial }: { value: Policy }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch("/api/platform/settings/subscriptions.policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) return setMessage({ tone: "error", text: result.error ?? "Could not save." });
    setMessage({ tone: "success", text: "Saved." });
    router.refresh();
  }
  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-3" data-policy-form>
      <Field label="Grace days after a paid period ends" hint="The pharmacy keeps working this many days if it has not renewed (0 = stop at once). Not for cancelled subscriptions.">
        <input type="number" min={0} max={30} className={inputClass} value={value.graceDays} onChange={(event) => setValue({ ...value, graceDays: Number(event.target.value) })} />
      </Field>
      <Field label="Refund approval" hint="Two people: a second billing administrator must approve each refund before it is sent.">
        <select className={inputClass} value={value.refundApproval} onChange={(event) => setValue({ ...value, refundApproval: event.target.value as Policy["refundApproval"] })}>
          <option value="two_person">Two people (recommended)</option>
          <option value="single">One person</option>
        </select>
      </Field>
      <Field label="Keep a closed pharmacy's data (days)" hint="Earliest date its data may be deleted after the account is closed.">
        <input type="number" min={30} max={3650} className={inputClass} value={value.closedRetentionDays} onChange={(event) => setValue({ ...value, closedRetentionDays: Number(event.target.value) })} />
      </Field>
      {message ? <div className="sm:col-span-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <div className="sm:col-span-3"><button type="submit" className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800">Save policy</button></div>
    </form>
  );
}
