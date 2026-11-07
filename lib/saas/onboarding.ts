// The new pharmacy's setup checklist. Every step is worked out from the pharmacy's own data each time,
// so it stays right whichever page the owner finishes a step on.
import { z } from "zod";

import { currentTenant, platformQuery } from "@/lib/db/database";
import { outlets, products, users } from "@/lib/data";
import { getStore } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { COUNTRIES, CURRENCIES, NIGERIAN_STATES } from "@/lib/saas/registration";

const phone = z.string().trim().refine((value) => /^\+?[\d\s()-]+$/.test(value) && value.replace(/\D/g, "").length >= 10 && value.replace(/\D/g, "").length <= 14, "Enter a valid phone number (10–14 digits).");

export const tenantProfileSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessEmail: z.string().trim().toLowerCase().email().max(160),
  businessPhone: phone,
  address: z.string().trim().min(5).max(240),
  country: z.enum(Object.keys(COUNTRIES) as [keyof typeof COUNTRIES, ...Array<keyof typeof COUNTRIES>]),
  state: z.string().trim().min(2).max(60),
  currency: z.enum(CURRENCIES),
  timeZone: z.string().refine((value) => Intl.supportedValuesOf("timeZone").includes(value) || value === "UTC", "Choose a valid time zone."),
}).refine((input) => input.country !== "NG" || (NIGERIAN_STATES as readonly string[]).includes(input.state), { path: ["state"], message: "Choose a Nigerian state." });

export type TenantProfile = z.infer<typeof tenantProfileSchema>;
export type OnboardingStep = { key: string; title: string; detail: string; done: boolean; href?: string; optional?: boolean };
export type SubscriptionSummary = { planName: string; status: string; trialEndsAt: string | null };

type TenantRow = { name: string; business_email: string | null; business_phone: string | null; address: string | null; country: string; state: string | null; currency: string; time_zone: string };

/** Must run inside the pharmacy's transaction. */
export async function onboardingStatus(actor: Actor) {
  const tenantId = currentTenant()?.id;
  if (!tenantId) throw new Error("No pharmacy selected.");
  type SubscriptionRow = { plan_name: string; status: string; trial_ends_at: Date | null };
  const [tenant, subscription] = await platformQuery<readonly [TenantRow | undefined, SubscriptionRow | undefined]>(async (query) => [
    (await query<TenantRow>(`SELECT name, business_email, business_phone, address, country, state, currency, time_zone FROM tenants WHERE id = $1`, [tenantId]))[0],
    (await query<SubscriptionRow>(
      `SELECT p.name AS plan_name, s.status, s.trial_ends_at FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1`,
      [tenantId],
    ))[0],
  ] as const);
  const me = users.find((row) => row.id === actor.id);
  const settings = getStore().settings;
  const store = getStore();
  const profileComplete = Boolean(tenant?.business_email && tenant.business_phone && tenant.address && tenant.state);

  const steps: OnboardingStep[] = [
    { key: "verify-email", title: "Confirm your email address", detail: me?.emailVerifiedAt ? `Confirmed: ${me.email}` : `We sent a link to ${me?.email ?? "your email"}.`, done: Boolean(me?.emailVerifiedAt) },
    { key: "profile", title: "Complete the business profile", detail: "Business email, phone, address, state, currency and time zone.", done: profileComplete },
    { key: "outlets", title: "Check your outlets", detail: `${outlets.length} outlet${outlets.length === 1 ? "" : "s"}. Add branches or a warehouse, and each one's address.`, done: outlets.length > 0 && outlets.every((outlet) => Boolean(outlet.address)), href: "/outlets" },
    { key: "products", title: "Add your products", detail: `${products.length} product${products.length === 1 ? "" : "s"} registered.`, done: products.length > 0, href: "/products/new" },
    { key: "suppliers", title: "Add your suppliers", detail: `${store.suppliers.length} supplier${store.suppliers.length === 1 ? "" : "s"}.`, done: store.suppliers.length > 0, href: "/contacts?tab=suppliers" },
    { key: "staff", title: "Invite your staff", detail: `${users.length} account${users.length === 1 ? "" : "s"} in this pharmacy.`, done: users.length > 1, href: "/users" },
    { key: "logo", title: "Upload your logo", detail: "Shown in the app and on receipts.", done: Boolean(settings.logoFile), href: "/settings#business-profile", optional: true },
  ];
  const required = steps.filter((step) => !step.optional);
  return {
    steps,
    completed: required.filter((step) => step.done).length,
    total: required.length,
    profile: {
      businessName: tenant?.name ?? settings.businessName,
      businessEmail: tenant?.business_email ?? "",
      businessPhone: tenant?.business_phone ?? "",
      address: tenant?.address ?? "",
      country: (tenant?.country && tenant.country in COUNTRIES ? tenant.country : "NG") as TenantProfile["country"],
      state: tenant?.state ?? "",
      currency: ((CURRENCIES as readonly string[]).includes(tenant?.currency ?? "") ? tenant?.currency : "NGN") as TenantProfile["currency"],
      timeZone: tenant?.time_zone ?? "Africa/Lagos",
    } satisfies TenantProfile,
    subscription: subscription
      ? { planName: subscription.plan_name, status: subscription.status, trialEndsAt: subscription.trial_ends_at ? new Date(subscription.trial_ends_at).toISOString() : null }
      : null,
  };
}
