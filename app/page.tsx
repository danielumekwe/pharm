// The public PharmaERP website. Pharmacy sign-in lives at /login and registration at /register.
// Plans, trial length and contact details are read live from the Control Centre; no tenant data is shown.
// Sections and styles: components/marketing/* and app/landing.css (scoped to .lp).
import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { connection } from "next/server";

import { loadOffer, primaryCta, type Offer } from "@/components/landing/offer";
import { faqs } from "@/components/marketing/content";
import { Navbar } from "@/components/marketing/navbar";
import { RevealObserver } from "@/components/marketing/reveal-observer";
import { AppDownload } from "@/components/marketing/sections/app-download";
import { Benefits } from "@/components/marketing/sections/benefits";
import { Faq } from "@/components/marketing/sections/faq";
import { Features } from "@/components/marketing/sections/features";
import { FinalCta } from "@/components/marketing/sections/final-cta";
import { Footer } from "@/components/marketing/sections/footer";
import { Hero } from "@/components/marketing/sections/hero";
import { HowItWorks } from "@/components/marketing/sections/how-it-works";
import { Intro } from "@/components/marketing/sections/intro";
import { ModuleStrip } from "@/components/marketing/sections/module-strip";
import { Pricing } from "@/components/marketing/sections/pricing";
import { SettingsPanel } from "@/components/marketing/sections/settings-panel";
import { Showcase } from "@/components/marketing/sections/showcase";
import { site } from "@/components/marketing/site";
import { auth } from "@/lib/auth";
import { maintenanceMessage } from "@/lib/platform/system";

const inter = Inter({ subsets: ["latin"], variable: "--font-lp-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-lp-jakarta", display: "swap" });

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
  const image = { url: "/landing/og-image.jpg", width: 1200, height: 630, alt: "PharmaERP pharmacy management software" };
  return {
    title: { absolute: site.title },
    description: site.description,
    keywords: ["pharmacy management software", "pharmacy POS", "pharmacy inventory", "batch and expiry tracking", "multi-outlet pharmacy", "Nigeria pharmacy software"],
    ...(base
      ? {
          metadataBase: new URL(base),
          alternates: { canonical: "/" },
          openGraph: { type: "website", url: "/", siteName: site.name, title: site.title, description: site.description, locale: "en_NG", images: [image] },
          twitter: { card: "summary_large_image", title: site.title, description: site.description, images: [image.url] },
        }
      : {
          openGraph: { type: "website", siteName: site.name, title: site.title, description: site.description, locale: "en_NG" },
          twitter: { card: "summary", title: site.title, description: site.description },
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
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: site.name,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Pharmacy management software",
      operatingSystem: "Web, Android",
      description: site.description,
      ...(base ? { url: `${base}/`, image: `${base}/landing/og-image.jpg` } : {}),
      publisher: { "@type": "Organization", name: site.developer },
      ...(offers.length ? { offers } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
    },
  ];
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default async function HomePage() {
  await connection();
  // One load per request, shared with the pricing section (it streams in after the rest of the page).
  const offerPromise = loadOffer();
  const [offer, paused, session] = await Promise.all([offerPromise, maintenanceMessage(), auth().catch(() => null)]);
  const cta = primaryCta(offer);
  const signedIn = Boolean(session?.user);
  const supportEmail = offer.contact.email ?? site.fallbackSupportEmail;

  return (
    <div data-landing className={`lp ${inter.variable} ${jakarta.variable}`} style={{ colorScheme: "light" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData(offer) }} />
      <noscript>
        <style>{`.lp .reveal{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <Navbar cta={cta} signedIn={signedIn} notice={paused} />
      <main id="main">
        <Hero cta={cta} />
        <ModuleStrip />
        <Intro />
        <Features />
        <Showcase />
        <SettingsPanel />
        <Benefits />
        <HowItWorks cta={cta} />
        <Pricing offer={offerPromise} />
        <AppDownload />
        <Faq supportEmail={supportEmail} />
        <FinalCta cta={cta} signedIn={signedIn} />
      </main>
      <Footer cta={cta} signedIn={signedIn} contact={offer.contact} />
      <RevealObserver />
    </div>
  );
}
