import { ArrowRight, BellRing, CalendarClock, Check } from "lucide-react";
import Image from "next/image";

import heroPhone from "@/public/landing/screenshots/hero-phone-stock-alerts.png";
import type { Cta } from "@/components/marketing/site";

const highlights = ["Works in any browser", "Android app included", "Built for multi-outlet pharmacies"];

export function Hero({ cta }: { cta: Cta }) {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative overflow-hidden bg-linear-to-b from-brand-50/70 via-white to-white pt-32 pb-16 md:pt-40 md:pb-24">
      <div aria-hidden="true">
        <div className="blob -top-24 -left-24 size-[420px] bg-brand-200" />
        <div className="blob top-40 -right-32 size-[460px] bg-brand-100 [animation-delay:-8s]" />
        <div className="blob -bottom-40 left-1/3 size-[360px] bg-[#e6f6d9] [animation-delay:-16s]" />
      </div>

      <div className="container-x relative grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="max-w-xl animate-lp-rise">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-4 py-1.5 text-[0.8125rem] font-semibold text-lp-ink-soft shadow-sm">
            <span className="size-2 rounded-full bg-brand-500 animate-lp-pulse" aria-hidden="true" />
            Pharmacy management software · Web &amp; Android
          </p>
          <h1 id="hero-title" className="text-[2.5rem] leading-[1.1] font-extrabold sm:text-5xl lg:text-[3.6rem]">
            Run Your Pharmacy Smarter. <span className="text-gradient">Manage Everything in One Place.</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-lp-muted">
            Manage pharmacy operations, inventory, sales, prescriptions, multiple outlets, staff, and business performance from one intelligent platform.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:gap-4">
            <a href={cta.href} className="btn btn-primary">
              {cta.label} <ArrowRight className="size-4" aria-hidden="true" />
            </a>
            <a href="#features" className="btn btn-secondary">Explore Features</a>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-lp-ink-soft">
            {highlights.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-brand-100 text-brand-700">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-[460px] animate-lp-rise [animation-delay:150ms] lg:max-w-[500px]">
          <div aria-hidden="true" className="absolute inset-x-8 top-16 bottom-6 rounded-[3rem] bg-linear-to-br from-brand-200/80 to-brand-50 blur-2xl" />
          <Image
            src={heroPhone}
            alt="PharmaERP Android app showing stock alerts by batch, expiry date and outlet, with an expired batch flagged in red"
            preload
            placeholder="blur"
            sizes="(min-width: 1024px) 500px, (min-width: 640px) 460px, 90vw"
            className="relative h-auto w-full animate-lp-float [mask-image:linear-gradient(to_bottom,black_82%,transparent)]"
          />

          {/* Floating widgets (template), describing what the screenshot shows */}
          <div aria-hidden="true" className="glass absolute top-[22%] -left-2 hidden items-center gap-3 rounded-2xl px-4 py-3 sm:flex lg:-left-12">
            <span className="grid size-9 place-items-center rounded-xl bg-red-50 text-red-600">
              <CalendarClock className="size-[18px]" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold text-lp-ink">Expired batch flagged</span>
              <span className="text-xs text-lp-muted">Batch HYC-5924 · shown in red</span>
            </span>
          </div>
          <div aria-hidden="true" className="glass absolute right-0 bottom-[16%] hidden items-center gap-3 rounded-2xl px-4 py-3 sm:flex lg:-right-6">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <BellRing className="size-[18px]" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold text-lp-ink">Daily inventory summary</span>
              <span className="text-xs text-lp-muted">Low stock · expiries · alerts</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
