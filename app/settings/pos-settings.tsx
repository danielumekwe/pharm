"use client";

import { useState } from "react";

import { ActionButton, Field, FormError, TextInput } from "@/components/erp/fields";
import { Panel } from "@/components/erp/stat-card";
import { useAction } from "@/components/erp/use-action";

/** Discount authority at the till and daily sales targets shown on sales dashboards. */
export function PosSettingsPanel({ pos, targets, outlets }: { pos: { cashierMaxDiscountPct: number; approverMaxDiscountPct: number }; targets: Record<string, number>; outlets: { id: string; name: string }[] }) {
  const { run, error, busy } = useAction();
  const [form, setForm] = useState({ cashier: String(pos.cashierMaxDiscountPct), approver: String(pos.approverMaxDiscountPct) });
  const [goals, setGoals] = useState<Record<string, string>>(() => Object.fromEntries(outlets.map((outlet) => [outlet.id, targets[outlet.id] ? String(targets[outlet.id]) : ""])));
  return (
    <Panel id="pos" title="Point of sale" description="Discount limits are enforced on the server for every sale; larger discounts need the “Authorise discounts” permission. Targets drive the progress bar on sales dashboards.">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Cashier discount limit (% of sale)" hint="Any cashier may give up to this without approval."><TextInput type="number" min={0} max={100} value={form.cashier} onChange={(event) => setForm((current) => ({ ...current, cashier: event.target.value }))} /></Field>
        <Field label="Supervisor discount ceiling (% of sale)" hint="Users with discount authority may go up to this."><TextInput type="number" min={0} max={100} value={form.approver} onChange={(event) => setForm((current) => ({ ...current, approver: event.target.value }))} /></Field>
        {outlets.map((outlet) => (
          <Field key={outlet.id} label={`Daily sales target — ${outlet.name} (₦)`} hint="Leave blank for no target.">
            <TextInput type="number" min={0} value={goals[outlet.id] ?? ""} onChange={(event) => setGoals((current) => ({ ...current, [outlet.id]: event.target.value }))} />
          </Field>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <FormError message={error} />
        <ActionButton
          disabled={busy}
          onClick={() =>
            void run("/api/settings/pos", "PATCH", {
              cashierMaxDiscountPct: Number(form.cashier) || 0,
              approverMaxDiscountPct: Number(form.approver) || 0,
              salesTargets: Object.fromEntries(Object.entries(goals).map(([id, value]) => [id, Number(value) || 0])),
            })
          }
        >
          Save POS settings
        </ActionButton>
      </div>
    </Panel>
  );
}
