import { AlertCircle } from "lucide-react";

import { primaryCta, type Offer } from "./offer";
import { PricingPlans } from "./pricing-plans";

const contactHref = "#contact";

/** Live plans from the Control Centre. Rendered on the server; a change to a plan shows on the next page load. */
export async function Pricing({ offer: pending }: { offer: Promise<Offer> }) {
  const offer = await pending;

  if (!offer.plans) {
    return (
      <div role="alert" className="mx-auto flex max-w-xl items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" data-pricing-error>
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          Pricing could not be loaded just now. Please refresh the page, or see the current plans on the{" "}
          <a href="/register" className="font-semibold underline">registration page</a>.
        </p>
      </div>
    );
  }
  if (offer.plans.length === 0) {
    return (
      <p className="mx-auto max-w-xl rounded-2xl border border-brand-100 bg-white p-5 text-center text-sm text-lp-muted" data-pricing-empty>
        Plans are being updated. <a href={contactHref} className="font-semibold text-brand-700 underline">Contact us</a> for current pricing.
      </p>
    );
  }
  return (
    <>
      {!offer.registrationOpen ? (
        <p className="mx-auto mb-8 max-w-xl rounded-full bg-amber-50 px-5 py-2.5 text-center text-sm text-amber-900">
          New registrations are paused at the moment. <a href={contactHref} className="font-semibold underline">Contact us</a> to open an account.
        </p>
      ) : null}
      <PricingPlans plans={offer.plans} ctaLabel={primaryCta(offer).label} contactHref={contactHref} />
    </>
  );
}

export function PricingSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading plans…</span>
      <div className="mx-auto h-12 w-56 animate-pulse rounded-full bg-brand-100/70" />
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-3xl border border-brand-100 bg-white p-8">
            <div className="h-5 w-28 animate-pulse rounded bg-brand-100" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-brand-50" />
            <div className="mt-6 h-9 w-40 animate-pulse rounded bg-brand-100" />
            <div className="mt-6 space-y-3">{[0, 1, 2, 3, 4].map((line) => <div key={line} className="h-3.5 w-4/5 animate-pulse rounded bg-brand-50" />)}</div>
            <div className="mt-8 h-12 animate-pulse rounded-full bg-brand-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
