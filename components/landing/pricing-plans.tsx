"use client";

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

/**
 * Plan cards with a monthly/yearly switch, styled for the public homepage (.lp scope).
 * Prices, limits, trials and modules all come from the plan configuration in the Control Centre.
 */
export function PricingPlans({ plans, ctaLabel, contactHref }: { plans: LandingPlan[]; ctaLabel: string; contactHref: string }) {
  const hasMonthly = plans.some((plan) => plan.monthlyPrice !== null);
  const hasAnnual = plans.some((plan) => plan.annualPrice !== null);
  const [cycle, setCycle] = useState<Cycle>(hasMonthly ? "monthly" : "annual");
  // Highlight the middle plan when there are three or more, as the template does.
  const featured = plans.length >= 3 ? Math.floor((plans.length - 1) / 2) : -1;

  return (
    <div>
      {hasMonthly && hasAnnual ? (
        <div className="flex justify-center">
          <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-brand-100 bg-white p-1.5 shadow-sm">
            {(["monthly", "annual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={cycle === option}
                onClick={() => setCycle(option)}
                className={`rounded-full px-6 py-2 text-sm font-semibold transition-colors ${cycle === option ? "bg-brand-600 text-white shadow-lp-brand" : "text-lp-muted hover:text-brand-700"}`}
              >
                {option === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ul className={`mx-auto mt-10 grid items-stretch gap-6 ${plans.length === 1 ? "max-w-md" : plans.length === 2 ? "max-w-3xl md:grid-cols-2" : "lg:grid-cols-3"}`}>
        {plans.map((plan, index) => {
          const price = cycle === "monthly" ? plan.monthlyPrice : plan.annualPrice;
          const custom = plan.monthlyPrice === null && plan.annualPrice === null;
          const saving = cycle === "annual" && plan.monthlyPrice && plan.annualPrice ? Math.round((1 - plan.annualPrice / (plan.monthlyPrice * 12)) * 100) : 0;
          const highlight = index === featured;
          return (
            <li
              key={plan.id}
              data-plan={plan.name}
              className={`relative flex flex-col rounded-3xl border p-7 transition-all duration-300 hover:-translate-y-1 sm:p-8 ${
                highlight ? "border-brand-600 bg-white shadow-lp-brand ring-1 ring-brand-600" : "border-brand-100 bg-white shadow-lp-soft"
              }`}
            >
              {highlight ? (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-linear-to-br from-brand-500 to-brand-700 px-4 py-1 text-xs font-bold tracking-wide text-white uppercase">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-xl font-bold">{plan.name}</h3>
              {plan.description ? <p className="mt-2 text-sm leading-relaxed text-lp-muted lg:min-h-[4.5rem]">{plan.description}</p> : null}

              <div className="mt-6 min-h-[5rem]">
                {custom ? (
                  <p className="font-lp-heading text-3xl font-extrabold">Price on request</p>
                ) : price === null ? (
                  <p className="text-base font-semibold text-lp-muted">{cycle === "monthly" ? "Billed yearly only" : "Billed monthly only"}</p>
                ) : (
                  <p className="flex items-baseline gap-1.5">
                    <span className="font-lp-heading text-4xl font-extrabold tracking-tight">{money(price, plan.currency)}</span>
                    <span className="text-sm text-lp-muted">/{cycle === "monthly" ? "month" : "year"}</span>
                  </p>
                )}
                {saving > 0 ? <p className="mt-1.5 text-sm font-semibold text-brand-700">Save {saving}% compared with monthly</p> : null}
                {plan.effectiveTrialDays > 0 ? <p className="mt-1.5 text-sm text-lp-muted">{plan.effectiveTrialDays}-day free trial</p> : null}
              </div>

              <ul className="mt-6 flex-1 space-y-3 border-t border-brand-100 pt-6 text-[0.9375rem]">
                {[
                  [true, limit(plan.maxOutlets, "outlet", "outlets")],
                  [true, limit(plan.maxStaffAccounts, "staff account", "staff accounts")],
                  [true, "Pharmacy POS and receipts"],
                  [true, "Inventory, batch and expiry tracking"],
                  [true, "Sales and inventory reports"],
                  [plan.stockTransfers, "Stock transfers between outlets"],
                  [plan.regulatory, "Regulatory document management"],
                ].map(([on, label]) => (
                  <li key={String(label)} className={`flex gap-2.5 ${on ? "text-lp-ink-soft" : "text-slate-400"}`}>
                    {on ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" strokeWidth={3} aria-hidden="true" />
                    ) : (
                      <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>{label}{on ? null : <span className="sr-only"> (not included)</span>}</span>
                  </li>
                ))}
              </ul>

              {custom && plan.effectiveTrialDays === 0 ? (
                <a href={contactHref} className="btn btn-secondary mt-8">Contact sales</a>
              ) : (
                <a href="/register" className={`btn mt-8 ${highlight ? "btn-primary" : "btn-secondary"}`}>
                  {plan.effectiveTrialDays > 0 ? ctaLabel : "Get started"}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
