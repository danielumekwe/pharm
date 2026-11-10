// The public PharmaERP website. Pharmacy sign-in lives at /login and registration at /register.
// Plans, trial length and contact details are read live from the Control Centre; no tenant data is shown.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, Check, CheckCircle2, Circle, Cloud, Lock, Mail, MessageSquare, Phone, Receipt, Smartphone, Store } from "lucide-react";

import { AndroidIcon, AppleIcon } from "@/components/android-icon";
import { DEVELOPER, FEATURES, HERO_PHOTO, STEPS, TRUST_POINTS } from "@/components/landing/content";
import { LandingLogo } from "@/components/landing/logo";
import { demoHref, loadOffer, primaryCta, type Offer } from "@/components/landing/offer";
import { DashboardPreview, ExpiryPreview, InventoryPreview, PosPreview, PreviewFrame } from "@/components/landing/previews";
import { Pricing, PricingSkeleton } from "@/components/landing/pricing";
import { SiteNav } from "@/components/landing/site-nav";
import { auth } from "@/lib/auth";
import { maintenanceMessage } from "@/lib/platform/system";

const TITLE = "PharmaERP | Smart Pharmacy Management Software";
const DESCRIPTION =
  "Manage pharmacy sales, inventory, batches, expiry dates, staff, and multiple outlets with PharmaERP, a powerful cloud-based pharmacy management platform.";

/** The production address (APP_URL, as used in account emails). */
function siteUrl() {
  const base = process.env.APP_URL || process.env.NEXTAUTH_URL;
  try {
    return base ? new URL(base).origin : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const base = siteUrl();
  const image = { url: "/pharmerp.png", width: 768, height: 512, alt: "PharmaERP — Pharmacy Management System" };
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    ...(base
      ? {
          metadataBase: new URL(base),
          alternates: { canonical: "/" },
          openGraph: { type: "website", url: "/", siteName: "PharmaERP", title: TITLE, description: DESCRIPTION, locale: "en_NG", images: [image] },
          twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [image.url] },
        }
      : {
          openGraph: { type: "website", siteName: "PharmaERP", title: TITLE, description: DESCRIPTION, locale: "en_NG" },
          twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
        }),
  };
}

function structuredData(offer: Offer) {
  const base = siteUrl();
  const offers = (offer.plans ?? []).filter((plan) => plan.monthlyPrice !== null).map((plan) => ({
    "@type": "Offer",
    name: plan.name,
    price: plan.monthlyPrice,
    priceCurrency: plan.currency,
    priceSpecification: { "@type": "UnitPriceSpecification", price: plan.monthlyPrice, priceCurrency: plan.currency, unitCode: "MON" },
  }));
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "PharmaERP",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, Android",
    description: DESCRIPTION,
    ...(base ? { url: `${base}/` } : {}),
    publisher: { "@type": "Organization", name: DEVELOPER },
    ...(offers.length ? { offers } : {}),
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const copyrightYear = () => new Date().getFullYear();

function SectionHeading({ eyebrow, title, text, id, invert = false }: { eyebrow: string; title: string; text?: string; id?: string; invert?: boolean }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className={`text-sm font-semibold uppercase tracking-[0.14em] ${invert ? "text-emerald-300" : "text-brand-green-dark"}`}>{eyebrow}</p>
      <h2 id={id} className={`mt-3 text-3xl font-bold tracking-tight sm:text-4xl ${invert ? "text-white" : "text-brand-ink"}`}>{title}</h2>
      {text ? <p className={`mt-4 text-lg leading-relaxed ${invert ? "text-slate-300" : "text-brand-muted"}`}>{text}</p> : null}
    </div>
  );
}

function HeroVisual() {
  if (HERO_PHOTO) {
    return (
      <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
        <div className="relative ml-auto aspect-[6/7] w-[78%] overflow-hidden rounded-2xl bg-brand-mist shadow-xl">
          <Image src={HERO_PHOTO.src} alt={HERO_PHOTO.alt} fill priority sizes="(min-width: 1024px) 40vw, 80vw" className="object-cover" />
        </div>
        <DashboardPreview className="absolute bottom-6 left-0 w-[78%]" />
      </div>
    );
  }
  return (
    <div className="relative mx-auto w-full max-w-xl pb-10 lg:max-w-none lg:pb-14 lg:pl-6">
      <DashboardPreview />
      <div className="absolute -bottom-1 -left-3 hidden items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg sm:flex lg:-left-2" aria-hidden="true">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-green text-white"><Receipt className="h-4.5 w-4.5" /></span>
        <span className="leading-tight">
          <span className="block text-xs font-semibold text-brand-ink">Sale completed · ₦7,150</span>
          <span className="block text-[11px] text-brand-muted">Paid by card · receipt ready</span>
        </span>
      </div>
      <div className="absolute -right-2 -top-5 hidden items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-lg sm:flex" aria-hidden="true">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-brand-green"><CheckCircle2 className="h-4.5 w-4.5" /></span>
        <span className="leading-tight">
          <span className="block text-xs font-semibold text-brand-ink">Stock synced</span>
          <span className="block text-[11px] text-brand-muted">All outlets up to date</span>
        </span>
      </div>
    </div>
  );
}

function OnboardingChecklist() {
  const items: Array<[string, boolean]> = [["Business details", true], ["First outlet", true], ["Add products and suppliers", false], ["Invite your staff", false]];
  return (
    <PreviewFrame title="Getting started" className="mx-auto max-w-md">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-brand-ink">Set up your pharmacy</p>
          <p className="text-xs font-medium text-brand-muted">2 of 4 done</p>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-slate-100"><div className="h-full w-1/2 rounded-full bg-brand-green" /></div>
        <ul className="mt-4 space-y-2.5 text-sm">
          {items.map(([label, done]) => (
            <li key={label} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2.5">
              {done ? <CheckCircle2 className="h-4.5 w-4.5 text-brand-green" /> : <Circle className="h-4.5 w-4.5 text-slate-300" />}
              <span className={done ? "text-brand-muted line-through decoration-slate-300" : "font-medium text-brand-ink"}>{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </PreviewFrame>
  );
}

export default async function HomePage() {
  await connection();
  // One load per request, shared with the pricing section (it streams in after the rest of the page).
  const offerPromise = loadOffer();
  const [offer, paused, session] = await Promise.all([offerPromise, maintenanceMessage(), auth().catch(() => null)]);
  const cta = primaryCta(offer);
  const demo = demoHref(offer.contact);
  const signedIn = Boolean(session?.user);

  return (
    <div data-landing className="flex min-h-screen flex-col bg-white text-brand-ink" style={{ colorScheme: "light" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData(offer) }} />
      {paused ? <div role="alert" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900" data-maintenance-banner>{paused}</div> : null}
      <SiteNav logo={<LandingLogo />} cta={cta} signedIn={signedIn} />

      <main id="top" className="flex-1">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden bg-gradient-to-b from-brand-sky to-white">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(26,90,166,0.09)_1px,transparent_0)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1fr_1.08fr] lg:gap-12 lg:px-8 lg:pb-24 lg:pt-20">
            <div className="max-w-xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-brand-blue/15 bg-white px-3 py-1 text-sm font-medium text-brand-blue shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-green" aria-hidden="true" /> Smart Pharmacy Management
              </p>
              <h1 id="hero-title" className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-brand-ink sm:text-5xl lg:text-[3.5rem]">
                Run Your Pharmacy.
                <span className="block text-brand-blue">Smarter. Faster. Better.</span>
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-brand-muted">
                Manage your pharmacy sales, inventory, prescriptions, suppliers, staff, and multiple outlets from one powerful cloud-based pharmacy management platform.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href={cta.href} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-blue px-6 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-brand-blue-dark">
                  {cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a href="#product" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3.5 text-base font-semibold text-brand-navy hover:border-brand-blue hover:text-brand-blue">
                  See it in action
                </a>
              </div>
              <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-brand-muted">
                {offer.trialDays > 0 ? <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-brand-green" aria-hidden="true" />{offer.trialDays}-day free trial</li> : null}
                {offer.trialDays > 0 ? <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-brand-green" aria-hidden="true" />No payment to start</li> : null}
                <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-brand-green" aria-hidden="true" />Web and Android</li>
              </ul>
            </div>
            <HeroVisual />
          </div>
        </section>

        {/* Trust indicators */}
        <section aria-label="Why pharmacies choose PharmaERP" className="border-y border-slate-100 bg-white">
          <ul className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
            {TRUST_POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-sky text-brand-blue"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                <span>
                  <span className="block font-semibold text-brand-ink">{title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-brand-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-title" className="bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              id="features-title"
              eyebrow="Features"
              title="Everything Your Pharmacy Needs in One Platform"
              text="Simplify everyday pharmacy operations with tools designed to help you manage your business efficiently."
            />
            <ul className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text, points }) => (
                <li key={title} className="rounded-xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-[0_16px_40px_-24px_rgba(15,42,82,0.35)]">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-blue text-white"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                  <h3 className="mt-5 text-lg font-bold text-brand-ink">{title}</h3>
                  <p className="mt-1.5 text-sm text-brand-muted">{text}</p>
                  <ul className="mt-4 space-y-2 text-sm text-brand-ink">
                    {points.map((point) => (
                      <li key={point} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" aria-hidden="true" />{point}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" aria-labelledby="how-title" className="bg-brand-sky py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading id="how-title" eyebrow="How it works" title="Get Your Pharmacy Up and Running in Simple Steps" />
            <ol className="relative mt-14 grid gap-8 lg:grid-cols-4 lg:gap-6">
              <span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-6 hidden h-px bg-brand-blue/20 lg:block" />
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative flex gap-4 lg:flex-col lg:items-center lg:text-center">
                  <span className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 border-brand-sky bg-brand-blue text-base font-bold text-white">{index + 1}</span>
                  <span>
                    <span className="block text-lg font-bold text-brand-ink lg:mt-4">{step.title}</span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-brand-muted">{step.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-14 grid items-center gap-10 lg:grid-cols-2">
              <div className="max-w-lg">
                <h3 className="text-2xl font-bold text-brand-ink">A guided start, not a blank screen</h3>
                <p className="mt-3 leading-relaxed text-brand-muted">
                  After you register, a setup checklist walks you through your business details, outlets, products and staff, so your team can start selling quickly.
                </p>
                <Link href={cta.href} className="mt-6 inline-flex items-center gap-2 font-semibold text-brand-blue hover:text-brand-blue-dark">
                  {cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
              <OnboardingChecklist />
            </div>
          </div>
        </section>

        {/* Product preview */}
        <section id="product" aria-labelledby="product-title" className="bg-brand-navy py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              id="product-title"
              invert
              eyebrow="Product"
              title="See PharmaERP in Action"
              text="One workspace for the counter, the stock room and the back office. The previews below use sample data."
            />
            <div className="mt-14 grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="mb-3 text-sm font-semibold text-slate-200">Pharmacy dashboard</p>
                <DashboardPreview />
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold text-slate-200">Point of sale</p>
                <PosPreview />
              </div>
              <div className="lg:col-span-2">
                <p className="mb-3 text-sm font-semibold text-slate-200">Inventory management</p>
                <InventoryPreview />
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold text-slate-200">Stock and expiry management</p>
                <ExpiryPreview />
              </div>
            </div>
          </div>
        </section>

        {/* Android app */}
        <section id="android-app" aria-labelledby="android-title" className="bg-brand-sky py-20 sm:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-green-dark">Android app</p>
              <h2 id="android-title" className="mt-3 text-3xl font-bold tracking-tight text-brand-ink sm:text-4xl">Your Pharmacy in Your Pocket</h2>
              <p className="mt-4 text-lg leading-relaxed text-brand-muted">
                The PharmaERP app for Android works with the same account and the same live data as the web: sell at the counter, scan barcodes with the phone camera, and keep an eye on sales and stock from anywhere.
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {["Point of sale with camera barcode scanning", "Today's sales, payment mix and top products", "Low-stock, out-of-stock and expiry alerts", "Transfers, sales history and the daily report"].map((point) => (
                  <li key={point} className="flex gap-2 text-brand-ink"><Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" aria-hidden="true" />{point}</li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a href="/downloads/PharmaERP.apk" download className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-ink px-6 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-black" data-android-download>
                  <AndroidIcon className="h-5 w-5" /> Download for Android
                </a>
                <span aria-disabled="true" title="iOS app coming soon" className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-brand-ink/20 bg-white px-6 py-3.5 text-base font-semibold text-brand-ink/60">
                  <AppleIcon className="h-5 w-5" /> iOS · Coming soon
                </span>
                <p className="text-sm text-brand-muted">Free with every plan · Android 7 or later · iOS coming soon</p>
              </div>
              <p className="mt-4 max-w-xl text-xs leading-relaxed text-brand-muted">
                Installing: open the downloaded file on your phone. If Android asks, allow installs from your browser for this download. Updates install over the existing app.
              </p>
            </div>
            <div aria-hidden="true" className="mx-auto w-full max-w-[290px]">
              <div className="rounded-[2.5rem] border-[10px] border-brand-ink bg-[#f2f6f3] p-3 shadow-2xl">
                <div className="rounded-2xl bg-[#0a4d29] p-4 text-white">
                  <p className="text-xs text-lime-200">Net sales · 7 days</p>
                  <p className="mt-1 text-2xl font-bold">₦1,284,500</p>
                  <div className="mt-3 flex h-14 items-end gap-1.5">{[40, 65, 50, 80, 55, 95, 70].map((height, index) => <span key={index} className="flex-1 rounded-sm bg-lime-300" style={{ height: `${height}%` }} />)}</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[["Low stock", "12", "text-amber-600"], ["Out of stock", "3", "text-rose-600"], ["Expiry alerts", "7", "text-violet-600"], ["Outlets", "4", "text-sky-700"]].map(([label, value, tone]) => (
                    <div key={label} className="rounded-xl bg-white p-2.5 shadow-sm"><p className={`text-lg font-bold ${tone}`}>{value}</p><p className="text-[11px] text-slate-500">{label}</p></div>
                  ))}
                </div>
                <div className="mt-3 rounded-xl bg-white p-3 text-center text-sm font-semibold text-[#0a4d29] shadow-sm">New sale · scan barcode</div>
                <p className="mt-2 text-center text-[10px] text-slate-400">Sample figures</p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" aria-labelledby="pricing-title" className="bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading id="pricing-title" eyebrow="Pricing" title="Simple, Transparent Pricing" text="Choose a plan that fits your pharmacy business." />
            <div className="mt-10">
              <Suspense fallback={<PricingSkeleton />}>
                <Pricing offer={offerPromise} />
              </Suspense>
            </div>
          </div>
        </section>

        {/* About */}
        <section id="about" aria-labelledby="about-title" className="bg-brand-sky py-20 sm:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-green-dark">About PharmaERP</p>
              <h2 id="about-title" className="mt-3 text-3xl font-bold tracking-tight text-brand-ink sm:text-4xl">Technology That Simplifies Pharmacy Management</h2>
              <p className="mt-5 text-lg leading-relaxed text-brand-muted">
                PharmaERP helps pharmacy businesses run their everyday operations from one central, secure, cloud-based platform: from the sales counter and stock room to branch transfers, reports and staff access.
              </p>
              <p className="mt-4 leading-relaxed text-brand-muted">
                It is designed and developed by <strong className="font-semibold text-brand-ink">{DEVELOPER}</strong> for pharmacies that want accurate stock, faster service and clear numbers without managing their own servers.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {[
                { icon: Cloud, title: "Cloud-based", text: "Your team works from any browser; updates arrive automatically." },
                { icon: Lock, title: "Your data, kept separate", text: "Each pharmacy's records are isolated, with staff permissions and an audit trail." },
                { icon: Store, title: "Built for branches", text: "Stock, sales and staff are managed per outlet and reported together." },
                { icon: Smartphone, title: "Android app", text: "Check stock and alerts on the go with the PharmaERP Android app." },
              ].map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-xl border border-slate-200 bg-white p-5">
                  <Icon className="h-5 w-5 text-brand-blue" aria-hidden="true" />
                  <p className="mt-3 font-semibold text-brand-ink">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-brand-muted">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final call to action and contact */}
        <section id="contact" aria-labelledby="cta-title" className="bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-2xl bg-brand-blue px-6 py-14 text-center sm:px-12">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.12)_1px,transparent_0)] [background-size:22px_22px]" />
              <div className="relative mx-auto max-w-2xl">
                <h2 id="cta-title" className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Take Control of Your Pharmacy Operations Today</h2>
                <p className="mt-4 text-lg text-blue-100">Bring your sales, inventory, outlets, and team together with PharmaERP.</p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                  <Link href={cta.href} className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3.5 font-semibold text-brand-blue shadow-sm hover:bg-brand-sky">
                    Get Started <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  {demo ? (
                    <a href={demo} className="inline-flex items-center justify-center rounded-lg border border-white/50 px-6 py-3.5 font-semibold text-white hover:bg-white/10">Book a Demo</a>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {offer.contact.email ? (
                <a href={`mailto:${offer.contact.email}`} className="flex gap-4 rounded-xl border border-slate-200 p-5 hover:border-brand-blue">
                  <Mail className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue" aria-hidden="true" />
                  <span><span className="block font-semibold text-brand-ink">Email us</span><span className="mt-1 block break-all text-sm text-brand-muted">{offer.contact.email}</span></span>
                </a>
              ) : null}
              {offer.contact.phone ? (
                <a href={`tel:${offer.contact.phone.replace(/[^\d+]/g, "")}`} className="flex gap-4 rounded-xl border border-slate-200 p-5 hover:border-brand-blue">
                  <Phone className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue" aria-hidden="true" />
                  <span><span className="block font-semibold text-brand-ink">Call us</span><span className="mt-1 block text-sm text-brand-muted">{offer.contact.phone}</span></span>
                </a>
              ) : null}
              <Link href="/login" className="flex gap-4 rounded-xl border border-slate-200 p-5 hover:border-brand-blue">
                <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue" aria-hidden="true" />
                <span><span className="block font-semibold text-brand-ink">Already a customer?</span><span className="mt-1 block text-sm text-brand-muted">Sign in and open a support ticket from the Support page.</span></span>
              </Link>
              {!offer.contact.email && !offer.contact.phone ? (
                <Link href={cta.href} className="flex gap-4 rounded-xl border border-slate-200 p-5 hover:border-brand-blue md:col-span-2">
                  <Store className="mt-0.5 h-5 w-5 shrink-0 text-brand-blue" aria-hidden="true" />
                  <span><span className="block font-semibold text-brand-ink">New to PharmaERP?</span><span className="mt-1 block text-sm text-brand-muted">Register your pharmacy online in a few minutes and set it up step by step.</span></span>
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-brand-navy text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
          <div className="max-w-sm">
            <LandingLogo inverted />
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              Cloud-based pharmacy management for sales, inventory, batches and expiry, staff and multiple outlets.
            </p>
          </div>
          <nav aria-label="Product">
            <p className="text-sm font-semibold text-white">Product</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><a href="#features" className="hover:text-white">Features</a></li>
              <li><a href="#how-it-works" className="hover:text-white">How it works</a></li>
              <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
              <li><a href="#about" className="hover:text-white">About</a></li>
            </ul>
          </nav>
          <nav aria-label="Account">
            <p className="text-sm font-semibold text-white">Get started</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link href="/login" className="hover:text-white">Login</Link></li>
              <li><Link href={cta.href} className="hover:text-white">Get Started</Link></li>
              <li><a href="#contact" className="hover:text-white">Contact</a></li>
              <li><a href="/downloads/PharmaERP.apk" className="hover:text-white">Android app</a></li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-7xl px-4 py-6 text-sm text-slate-400 sm:px-6 lg:px-8">{`© ${copyrightYear()} PharmaERP. Developed by ${DEVELOPER}.`}</p>
        </div>
      </footer>
    </div>
  );
}
