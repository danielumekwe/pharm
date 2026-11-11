import { Check } from "lucide-react";

import { BrowserFrame } from "@/components/marketing/device-frames";
import inventory from "@/public/landing/screenshots/desktop-inventory.jpg";

const points = [
  {
    title: "Every stock movement on a ledger",
    text: "Stock levels change only through receipts, sales, transfers and approved adjustments, so balances always add up.",
  },
  {
    title: "Built around batches and expiry",
    text: "Search by name, generic name, barcode, batch or NAFDAC number, and see stock expiring within your warning window at a glance.",
  },
  {
    title: "Each outlet separate, all connected",
    text: "Every item, batch and balance is kept per outlet, while owners see the whole business from one account.",
  },
];

export function Intro() {
  return (
    <section id="about" aria-labelledby="about-title" className="section-y bg-white">
      <div className="container-x grid items-center gap-14 lg:grid-cols-2">
        <div className="reveal" data-dir="left">
          <span className="subtitle-pill">Why PharmaERP</span>
          <h2 id="about-title" className="text-3xl leading-tight font-extrabold sm:text-4xl">
            Pharmacy operations, simplified from counter to back office
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-lp-muted">
            Paper stock cards, separate spreadsheets and guesswork about expiry dates cost pharmacies money every day. PharmaERP replaces them with one system your whole team works from.
          </p>
          <ul className="mt-8 space-y-6">
            {points.map((point) => (
              <li key={point.title} className="flex gap-4">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-brand-500 to-brand-700 text-white">
                  <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-[1.0625rem] font-bold">{point.title}</h3>
                  <p className="mt-1 text-[0.9375rem] leading-relaxed text-lp-muted">{point.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="reveal relative" data-dir="right">
          <div aria-hidden="true" className="absolute -inset-6 -z-0 rounded-[2.5rem] bg-linear-to-br from-brand-100 to-brand-50/30" />
          <BrowserFrame
            src={inventory}
            url="pharmerp.name.ng/products"
            alt="PharmaERP inventory and item master screen with item count, inventory value, low stock and expired stock cards, and filters by category, stock level, expiry and batch"
            className="relative"
          />
        </div>
      </div>
    </section>
  );
}
