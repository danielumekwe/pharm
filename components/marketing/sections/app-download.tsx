import { Download, Smartphone } from "lucide-react";

import { PhoneFrame } from "@/components/marketing/device-frames";
import support from "@/public/landing/screenshots/mobile-support.jpg";
import { links } from "@/components/marketing/site";

export function AppDownload() {
  return (
    <section id="android-app" aria-labelledby="app-title" className="section-y overflow-hidden bg-white">
      <div className="container-x">
        <div className="relative grid items-center gap-12 overflow-hidden rounded-[2.5rem] bg-linear-to-br from-brand-50 via-white to-brand-100/60 px-6 py-14 ring-1 ring-brand-100 sm:px-12 lg:grid-cols-[1.2fr_1fr] lg:py-16">
          <div className="reveal" data-dir="left">
            <span className="subtitle-pill">Mobile app</span>
            <h2 id="app-title" className="text-3xl leading-tight font-extrabold sm:text-4xl">Your pharmacy in your pocket</h2>
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-lp-muted">
              Sell, check stock alerts, follow the daily report and raise support tickets from the PharmaERP Android app. It uses the same account as the web app.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={links.androidApk} download className="btn btn-primary">
                <Download className="size-4" aria-hidden="true" /> Download for Android
              </a>
              <span className="inline-flex items-center justify-center gap-2 rounded-full border border-dashed border-brand-200 px-6 py-3.5 text-sm font-semibold text-lp-muted">
                <Smartphone className="size-4" aria-hidden="true" /> iOS coming soon
              </span>
            </div>
            <p className="mt-4 text-sm text-lp-muted">Free with every plan · Android 7 or later</p>
          </div>
          <div className="reveal" data-dir="right">
            <PhoneFrame
              src={support}
              alt="PharmaERP Android app support screen for raising and following tickets with the Web365 support team"
              className="max-w-[250px] rotate-2"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
