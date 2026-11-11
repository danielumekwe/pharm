import { Check } from "lucide-react";
import type { StaticImageData } from "next/image";

import { BrowserFrame, PhoneFrame } from "@/components/marketing/device-frames";
import { SectionHeader } from "@/components/marketing/section-header";
import notifications from "@/public/landing/screenshots/desktop-notifications.jpg";
import productRegistration from "@/public/landing/screenshots/desktop-product-registration.jpg";
import salesHistory from "@/public/landing/screenshots/desktop-sales-history.jpg";
import dailyReport from "@/public/landing/screenshots/mobile-daily-report.jpg";
import pos from "@/public/landing/screenshots/mobile-pos.jpg";

type Row = {
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  image: { kind: "browser"; src: StaticImageData; url: string; alt: string } | { kind: "phone"; src: StaticImageData; alt: string };
};

const rows: Row[] = [
  {
    eyebrow: "Operations",
    title: "Monitor your pharmacy operations",
    text: "Start each day knowing where you stand. PharmaERP sends a daily inventory summary and keeps alerts one click away in the top bar.",
    points: ["Low-stock and out-of-stock counts", "Outlets with critical shortages", "Expired batches valued at cost", "Products approaching expiry"],
    image: {
      kind: "browser",
      src: notifications,
      url: "pharmerp.name.ng/sales",
      alt: "PharmaERP notifications panel showing a daily inventory summary with low-stock products, outlets with critical shortages, expired batches and products approaching expiry",
    },
  },
  {
    eyebrow: "Point of Sale",
    title: "Manage sales with a fast, focused POS",
    text: "Search by name or scan a barcode, adjust quantities and complete the sale in seconds, at the counter or on an Android phone.",
    points: ["Barcode scanning with the phone camera", "Cash, POS terminal and bank transfer", "Prescription reference for POM items", "VAT and discounts applied on recording"],
    image: {
      kind: "phone",
      src: pos,
      alt: "PharmaERP Android point of sale with Paracetamol 500mg in the basket and cash, POS and transfer payment options",
    },
  },
  {
    eyebrow: "Inventory",
    title: "Track inventory and medication expiry",
    text: "Register each product once with its generic name, dosage form, strength, packaging and reorder level, then record batch, expiry and opening stock.",
    points: ["Packaging levels convert to the base unit", "Prescription-only and controlled drug flags", "Existing, internal or no barcode", "Reorder level drives low-stock alerts"],
    image: {
      kind: "browser",
      src: productRegistration,
      url: "pharmerp.name.ng/products/new",
      alt: "PharmaERP register product form with general information, barcode options, packaging, pricing, regulatory information and batch, expiry and opening stock steps",
    },
  },
  {
    eyebrow: "Multi-outlet",
    title: "Manage multiple pharmacy outlets",
    text: "See total sales, transactions, expenses and gross profit for the whole business, with sales broken down by outlet, from your phone.",
    points: ["Daily report across all outlets", "Sales by outlet side by side", "Payments and top-selling products", "Switch outlet without signing out"],
    image: {
      kind: "phone",
      src: dailyReport,
      alt: "PharmaERP daily report on Android showing total sales, transactions, expenses, gross profit and sales broken down by outlet",
    },
  },
  {
    eyebrow: "Reports",
    title: "Monitor business performance with reports",
    text: "Review completed, held-over and voided transactions with discounts, returns and net amounts. Voided sales never count towards totals.",
    points: ["Filter by date, cashier, payment and status", "Gross sales, discounts, returns and net", "Export transactions to CSV", "Profit & loss and financial reports"],
    image: {
      kind: "browser",
      src: salesHistory,
      url: "pharmerp.name.ng/sales",
      alt: "PharmaERP sales history with date, cashier, payment method and status filters and completed transactions, gross sales, discounts and returns, and net sales totals",
    },
  },
];

export function Showcase() {
  return (
    <section id="product" aria-labelledby="product-title" className="section-y overflow-hidden bg-white">
      <div className="container-x">
        <SectionHeader
          id="product-title"
          eyebrow="Inside PharmaERP"
          title="Built for the way pharmacies work"
          text="Real screens from PharmaERP on the web and on Android."
        />
        <div className="space-y-24 md:space-y-32">
          {rows.map((row, index) => {
            const flip = index % 2 === 1;
            return (
              <article key={row.title} className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                <div className={`reveal ${flip ? "lg:order-2" : ""}`} data-dir={flip ? "right" : "left"}>
                  <p className="mb-3 text-sm font-bold tracking-[0.12em] text-brand-600 uppercase">{row.eyebrow}</p>
                  <h3 className="text-2xl leading-snug font-extrabold sm:text-3xl">{row.title}</h3>
                  <p className="mt-4 text-[1.0625rem] leading-relaxed text-lp-muted">{row.text}</p>
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {row.points.map((point) => (
                      <li key={point} className="flex gap-2.5 text-[0.9375rem] text-lp-ink-soft">
                        <Check className="mt-0.5 size-4 shrink-0 text-brand-600" strokeWidth={3} aria-hidden="true" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={`reveal relative ${flip ? "lg:order-1" : ""}`} data-dir={flip ? "left" : "right"}>
                  <div aria-hidden="true" className={`absolute top-1/2 left-1/2 -z-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-100/70 blur-3xl ${row.image.kind === "phone" ? "size-80" : "h-72 w-[90%]"}`} />
                  {row.image.kind === "browser" ? (
                    <BrowserFrame src={row.image.src} url={row.image.url} alt={row.image.alt} className="relative" />
                  ) : (
                    <PhoneFrame src={row.image.src} alt={row.image.alt} className="relative" />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
