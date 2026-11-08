"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { useState } from "react";

import type { LandingPlan } from "./offer";

type Cycle = "monthly" | "annual";

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-NG")}`;
  }
}

const limit = (value: number | null, one: string, many: string) =>
  value === null ? `Unlimited ${many}` : `Up to ${value.toLocaleString("en-NG")} ${value === 1 ? one : many}`;

/** Plan cards with a monthly/yearly switch. Prices, limits and modules all come from the plan configuration. */
export function PricingPlans({ plans, ctaLabel, contactHref }: { plans: LandingPlan[]; ctaLabel: string; contactHref: string }) {
  const hasMonthly = plans.some((plan) => plan.monthlyPrice !== null);
  const hasAnnual = plans.some((plan) => plan.annualPrice !== null);
  const [cycle, setCycle] = useState<Cycle>(hasMonthly ? "monthly" : "annual");

  return (
    <div>
      {hasMonthly && hasAnnual ? (
        <div className="flex justify-center">
          <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            {(["monthly", "annual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={cycle === option}
                onClick={() => setCycle(option)}
                className={`rounded-md px-5 py-2 text-sm font-semibold transition-colors ${cycle === option ? "bg-brand-blue text-white" : "text-brand-muted hover:text-brand-ink"}`}
              >
                {option === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ul className={`mx-auto mt-10 grid gap-6 ${plans.length === 1 ? "max-w-md" : plans.length === 2 ? "max-w-3xl md:grid-cols-2" : "lg:grid-cols-3"}`}>
        {plans.map((plan) => {
          const price = cycle === "monthly" ? plan.monthlyPrice : plan.annualPrice;
          const custom = plan.monthlyPrice === null && plan.annualPrice === null;
          const saving = cycle === "annual" && plan.monthlyPrice && plan.annualPrice ? Math.round((1 - plan.annualPrice / (plan.monthlyPrice * 12)) * 100) : 0;
          return (
            <li key={plan.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-[0_12px_40px_-24px_rgba(15,42,82,0.3)] sm:p-7" data-plan={plan.name}>
              <h3 className="text-lg font-bold text-brand-ink">{plan.name}</h3>
              {plan.description ? <p className="mt-1.5 text-sm lg:min-h-[4.5rem] leading-relaxed text-brand-muted">{plan.description}</p> : null}

              <div className="mt-5 min-h-[4.5rem]">
                {custom ? (
                  <p className="text-2xl font-bold text-brand-ink">Price on request</p>
                ) : price === null ? (
                  <p className="text-base font-semibold text-brand-muted">{cycle === "monthly" ? "Billed yearly only" : "Billed monthly only"}</p>
                ) : (
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold tracking-tight text-brand-ink">{money(price, plan.currency)}</span>
                    <span className="text-sm text-brand-muted">/{cycle === "monthly" ? "month" : "year"}</span>
                  </p>
                )}
                {saving > 0 ? <p className="mt-1 text-sm font-medium text-brand-green-dark">Save {saving}% compared with monthly</p> : null}
                {plan.effectiveTrialDays > 0 ? <p className="mt-1 text-sm text-brand-muted">{plan.effectiveTrialDays}-day free trial</p> : null}
              </div>

              <ul className="mt-5 flex-1 space-y-2.5 border-t border-slate-100 pt-5 text-sm">
                {[
                  [true, limit(plan.maxOutlets, "outlet", "outlets")],
                  [true, limit(plan.maxStaffAccounts, "staff account", "staff accounts")],
                  [true, "Pharmacy POS and receipts"],
                  [true, "Inventory, batch and expiry tracking"],
                  [true, "Sales and inventory reports"],
                  [plan.stockTransfers, "Stock transfers between outlets"],
                  [plan.regulatory, "Regulatory document management"],
                ].map(([on, label]) => (
                  <li key={String(label)} className={`flex gap-2.5 ${on ? "text-brand-ink" : "text-slate-400"}`}>
                    {on ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" aria-hidden="true" /> : <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span>{label}{on ? null : <span className="sr-only"> (not included)</span>}</span>
                  </li>
                ))}
              </ul>

              {custom && plan.effectiveTrialDays === 0 ? (
                <a href={contactHref} className="mt-7 rounded-lg border border-brand-blue px-4 py-3 text-center text-sm font-semibold text-brand-blue hover:bg-brand-sky">Contact sales</a>
              ) : (
                <Link href="/register" className="mt-7 rounded-lg bg-brand-blue px-4 py-3 text-center text-sm font-semibold text-white hover:bg-brand-blue-dark">
                  {plan.effectiveTrialDays > 0 ? ctaLabel : "Get started"}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
