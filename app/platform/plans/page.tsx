import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformPage } from "@/lib/platform/pages";
import { listPlanConfigurations } from "@/lib/platform/plans";

import { NewPlan } from "./new-plan";
import { PlansEditor } from "./plans-editor";

export const metadata = { title: "Subscription plans · Web365 platform" };

export default async function PlatformPlansPage() {
  const actor = await requirePlatformPage("plans.manage");
  const plans = await listPlanConfigurations();
  return (
    <PlatformShell actor={actor}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Subscription plans</h1>
          <p className="mt-1 text-sm text-slate-600">Set prices, quotas and optional feature allowlists. Blank limits and feature lists remain unconfigured.</p>
        </div>
        <NewPlan nextOrder={Math.max(0, ...plans.map((plan) => plan.sortOrder)) + 1} />
      </div>
      <PlansEditor key={plans.map((plan) => plan.id).join(",")} plans={plans} />
    </PlatformShell>
  );
}
