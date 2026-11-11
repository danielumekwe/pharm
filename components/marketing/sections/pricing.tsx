import { Suspense } from "react";

import { SectionHeader } from "@/components/marketing/section-header";
import type { Offer } from "@/components/landing/offer";
import { Pricing as LivePricing, PricingSkeleton } from "@/components/landing/pricing";

/** Plans, prices, trials and limits are read live from the Control Centre (plans table) on every request. */
export function Pricing({ offer }: { offer: Promise<Offer> }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="section-y bg-lp-surface">
      <div className="container-x">
        <SectionHeader
          id="pricing-title"
          eyebrow="Pricing"
          title="Plans that grow with your pharmacy"
          text="Simple, transparent pricing. Choose the plan that fits your pharmacy today and change it as you add outlets and staff."
        />
        <Suspense fallback={<PricingSkeleton />}>
          <LivePricing offer={offer} />
        </Suspense>
        <p className="mt-10 text-center text-sm text-lp-muted">
          Every plan includes the Android app, stock alerts and supplier records. Subscriptions and billing are managed from inside the app.
        </p>
      </div>
    </section>
  );
}
