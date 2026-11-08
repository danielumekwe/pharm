import Link from "next/link";
import type { ReactNode } from "react";

import { BrandWordmark } from "@/components/branding";

/** Centred card used by the public account pages (registration, password reset, email confirmation). */
export function AuthCard({ title, subtitle, children, wide = false }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-[#f2f6f3] px-4 py-10 text-slate-900 sm:items-center">
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} rounded-[28px] bg-white px-6 py-8 shadow-[0_30px_80px_-30px_rgba(15,81,50,0.35)] sm:px-10`}>
        <div className="flex flex-col items-center text-center">
          <Link href="/" aria-label="PharmaERP home"><BrandWordmark className="h-14 w-auto" /></Link>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-slate-600">{subtitle}</p> : null}
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export const inputClass =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-green-600 focus:ring-2 focus:ring-green-600/15";
export const buttonClass =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-green-600 to-green-800 text-[16px] font-semibold text-white shadow-sm transition hover:from-green-600 hover:to-green-700 disabled:opacity-60";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-800">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Notice({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const styles = { error: "border-rose-200 bg-rose-50 text-rose-700", success: "border-green-200 bg-green-50 text-green-800", info: "border-slate-200 bg-slate-50 text-slate-700" }[tone];
  return <p role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</p>;
}
