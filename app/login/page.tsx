import { maintenanceMessage } from "@/lib/platform/system";
import {
  ArrowLeftRight,
  Barcode,
  Boxes,
  ChartNoAxesColumnIncreasing,
  FileCheck,
  Pill,
  ShoppingCart,
  Users,
} from "lucide-react";

import { connection } from "next/server";

import { BrandName, BrandWordmark } from "@/components/branding";
import { LoginForm } from "@/components/login-form";
import { WelcomeSlides } from "@/components/welcome-slides";

const features = [
  { icon: ShoppingCart, label: "POS & Sales" },
  { icon: Boxes, label: "Inventory & Stock" },
  { icon: Barcode, label: "Barcode Scanning" },
  { icon: Pill, label: "Batch & Expiry Control" },
  { icon: FileCheck, label: "Regulatory Affairs" },
  { icon: ArrowLeftRight, label: "Stock Transfer" },
  { icon: ChartNoAxesColumnIncreasing, label: "Reports & Analytics" },
  { icon: Users, label: "Multi-Outlet Management" },
];

// Soft, out-of-focus "pharmacy shelves" behind the welcome copy.
const shelfBackdrop = {
  backgroundImage: [
    "radial-gradient(ellipse 40% 30% at 85% 35%, rgba(255,255,255,0.10), transparent 70%)",
    "radial-gradient(ellipse 30% 20% at 10% 60%, rgba(163,230,53,0.10), transparent 70%)",
    "repeating-linear-gradient(180deg, transparent 0 118px, rgba(255,255,255,0.07) 118px 124px, transparent 124px 150px)",
    "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 26px, transparent 26px 44px, rgba(255,255,255,0.03) 44px 62px, transparent 62px 90px)",
    "linear-gradient(135deg, #0a4d29 0%, #0d6a33 45%, #12813c 100%)",
  ].join(","),
};

export default async function HomePage() {
  // Public page: it shows no pharmacy or outlet names. Locations are listed only after the password is checked.
  await connection();
  const paused = await maintenanceMessage();

  return (
    <>
    {paused ? <div role="alert" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900" data-maintenance-banner>{paused}</div> : null}
    <main className="flex min-h-screen flex-col bg-[#f2f6f3] text-slate-900 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)]">
      <section className="relative order-2 overflow-hidden px-5 pb-12 pt-8 text-white sm:px-10 lg:order-none lg:px-14 lg:py-12" style={shelfBackdrop}>
        <div className="pointer-events-none absolute inset-0 backdrop-blur-[2px]" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-[140%] rounded-[50%] bg-gradient-to-r from-lime-400/25 via-green-500/20 to-transparent blur-sm" />

        {/* Curved divider into the sign-in panel (desktop). */}
        <svg className="absolute inset-y-0 right-0 hidden h-full w-40 lg:block" viewBox="0 0 160 1000" preserveAspectRatio="none" aria-hidden="true">
          <path d="M160 0H70C150 180 30 360 70 520C110 700 10 860 60 1000H160Z" fill="#f2f6f3" />
          <path d="M70 0C150 180 30 360 70 520C110 700 10 860 60 1000" fill="none" stroke="#9be22d" strokeWidth="10" />
        </svg>

        <div className="relative max-w-3xl lg:pr-28">
          <div className="hidden items-center gap-4 sm:gap-5 lg:flex">
            <div className="rounded-2xl bg-white/95 px-4 py-2 shadow-lg">
              <BrandWordmark className="h-14 w-auto sm:h-16" />
            </div>
          </div>

          <h1 className="text-4xl lg:mt-10 font-bold leading-[1.08] tracking-tight sm:text-5xl xl:text-6xl">
            Welcome to
            <br />
            <span className="relative inline-block">
              <BrandName />
              <svg className="absolute -bottom-3 right-0 h-3 w-3/5" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 10C60 2 140 0 198 6" fill="none" stroke="#a3e635" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </span>
          </h1>

          <p className="mt-8 max-w-xl text-lg leading-relaxed text-emerald-50/90 sm:text-xl">
            A complete solution to manage your pharmacy operations, inventory, sales, regulatory affairs and multiple outlets — all in one place.
          </p>

          <ul className="mt-9 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {features.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl sm:aspect-[1.05] sm:gap-3 border border-white/20 bg-white/10 p-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-sm"
              >
                <Icon className="h-7 w-7 sm:h-10 sm:w-10" strokeWidth={1.6} />
                <span className="text-sm font-medium leading-tight sm:text-[15px]">{label}</span>
              </li>
            ))}
          </ul>

          <div className="mt-10">
            <WelcomeSlides />
          </div>
        </div>
      </section>

      <section className="order-1 flex items-start justify-center px-4 py-6 sm:px-8 lg:order-none lg:items-center lg:py-12 lg:pr-12">
        <LoginForm />
      </section>
    </main>
    </>
  );
}
