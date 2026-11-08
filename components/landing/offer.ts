// What the public landing page offers, read live from the Control Centre: public plans, the trial and
// registration switches, and Web365's published contact details. Nothing here is tenant data.
import { cache } from "react";

import { readPlatformSetting } from "@/lib/platform/settings";
import { systemConfig } from "@/lib/platform/system";
import { publicPlans, type PublicPlan } from "@/lib/saas/registration";

export type LandingPlan = PublicPlan & {
  /** Trial days a new pharmacy would get today (0 when trials are switched off). */
  effectiveTrialDays: number;
  /** Optional modules, from the plan's feature allowlist (null allowlist means everything is included). */
  stockTransfers: boolean;
  regulatory: boolean;
};

export type Offer = {
  plans: LandingPlan[] | null;
  trialDays: number;
  registrationOpen: boolean;
  contact: { email: string | null; phone: string | null };
};

const included = (features: string[] | null, key: string) => features === null || features.includes(key);

export const loadOffer = cache(async (): Promise<Offer> => {
  const [plans, config, branding] = await Promise.all([
    publicPlans().catch((error: unknown) => {
      console.error("[landing] plans unavailable", error instanceof Error ? error.message : error);
      return null;
    }),
    systemConfig(),
    readPlatformSetting("branding.app").then((setting) => setting.value).catch(() => null),
  ]);
  const trialFor = (plan: PublicPlan) => (config.trialsEnabled ? config.trialDaysOverride ?? plan.trialDays : 0);
  const landingPlans = plans?.map((plan) => ({
    ...plan,
    effectiveTrialDays: trialFor(plan),
    stockTransfers: included(plan.features, "stock_transfers"),
    regulatory: included(plan.features, "regulatory_management"),
  })) ?? null;
  return {
    plans: landingPlans,
    trialDays: Math.max(0, ...(landingPlans ?? []).map((plan) => plan.effectiveTrialDays)),
    registrationOpen: config.registrationOpen && !config.maintenance,
    contact: { email: branding?.supportEmail || null, phone: branding?.supportPhone || null },
  };
});

/** "Start Free Trial" only when a trial is actually on offer. */
export function primaryCta(offer: Offer) {
  return { label: offer.trialDays > 0 ? "Start Free Trial" : "Get Started", href: "/register" };
}

export function demoHref(contact: Offer["contact"]) {
  if (contact.email) return `mailto:${contact.email}?subject=${encodeURIComponent("PharmaERP demo request")}`;
  if (contact.phone) return `tel:${contact.phone.replace(/[^\d+]/g, "")}`;
  return null;
}
