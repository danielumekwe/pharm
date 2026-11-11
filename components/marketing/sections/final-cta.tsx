import { ArrowRight } from "lucide-react";

import { links, type Cta } from "@/components/marketing/site";

export function FinalCta({ cta, signedIn }: { cta: Cta; signedIn: boolean }) {
  return (
    <section aria-labelledby="cta-title" className="bg-white py-20 md:py-24">
      <div className="container-x">
        <div className="reveal relative overflow-hidden rounded-[2.5rem] bg-linear-to-br from-brand-600 via-brand-700 to-brand-900 px-6 py-16 text-center shadow-lp-brand sm:px-12 md:py-20" data-dir="scale">
          <div aria-hidden="true" className="absolute -top-24 -left-24 size-72 rounded-full bg-brand-400/30 blur-3xl" />
          <div aria-hidden="true" className="absolute -right-24 -bottom-24 size-72 rounded-full bg-brand-300/20 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <h2 id="cta-title" className="text-3xl leading-tight font-extrabold !text-white sm:text-4xl md:text-5xl">
              Ready to run your pharmacy smarter?
            </h2>
            <p className="mt-5 text-lg text-brand-100/90">
              Bring sales, stock, expiry, outlets and staff together in PharmaERP. Set up your pharmacy today.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
              <a href={cta.href} className="btn btn-light">
                {cta.label} <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              {signedIn ? (
                <a href={links.dashboard} className="btn btn-outline-light">Go to your dashboard</a>
              ) : (
                <a href={links.login} className="btn btn-outline-light">Sign in to your pharmacy</a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
