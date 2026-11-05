import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { money } from "@/lib/format";

/**
 * The one action a role needs most (NEW SALE, RECEIVE STOCK…): large, blue, first in the content area.
 * It is a real link, so it works without JavaScript and opens the full-screen tool directly.
 */
export function PrimaryAction({ href, title, text, icon: Icon, meta }: { href: string; title: string; text: string; icon: LucideIcon; meta?: ReactNode }) {
  return (
    <Link
      href={href}
      data-primary-action
      className="group flex flex-col gap-4 rounded-2xl bg-blue-600 p-6 text-[#fff] shadow-lg shadow-blue-600/25 outline-none transition hover:bg-blue-700 focus-visible:ring-4 focus-visible:ring-blue-300 sm:flex-row sm:items-center sm:p-8"
    >
      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#ffffff26] sm:h-20 sm:w-20">
        <Icon className="h-9 w-9 sm:h-11 sm:w-11" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</span>
        <span className="mt-1 block text-sm text-blue-50 sm:text-base">{text}</span>
        {meta ? <span className="mt-3 flex flex-wrap gap-2 text-xs text-blue-50">{meta}</span> : null}
      </span>
      <span className="inline-flex items-center gap-2 self-start rounded-xl bg-[#fff] px-4 py-2.5 text-sm font-semibold text-blue-700 transition group-hover:gap-3 sm:self-center">
        Open <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-[#ffffff26] px-2.5 py-1">{children}</span>;
}

type Tone = "blue" | "green" | "amber" | "rose" | "slate";
const tones: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-500/10 text-emerald-300",
  amber: "bg-amber-500/10 text-amber-300",
  rose: "bg-rose-500/10 text-rose-300",
  slate: "bg-slate-800 text-slate-500",
};

export function Kpi({ label, value, note, icon: Icon, tone = "blue", href }: { label: string; value: string; note?: ReactNode; icon: LucideIcon; tone?: Tone; href?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" /></span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-white">{value}</p>
      {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
    </>
  );
  const className = "block rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm";
  return href ? <Link href={href} className={`${className} transition hover:border-blue-300 hover:shadow-md`}>{body}</Link> : <div className={className}>{body}</div>;
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function Card({ title, description, action, children, className = "" }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-800 bg-slate-900 shadow-sm ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
      {children} <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/** Horizontal bars, e.g. sales by outlet or cashier. */
export function BarList({ rows, format = money, empty = "Nothing to show yet." }: { rows: { name: string; value: number; note?: string }[]; format?: (value: number) => string; empty?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.name}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-300">{row.name}{row.note ? <span className="ml-2 text-xs text-slate-500">{row.note}</span> : null}</span>
            <span className="shrink-0 tabular-nums font-medium text-white">{format(row.value)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function QuickActions({ actions }: { actions: { href: string; label: string; icon: LucideIcon }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {actions.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-300 shadow-sm transition hover:border-blue-300 hover:text-blue-700">
          <Icon className="h-5 w-5 text-blue-600" /> {label}
        </Link>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: Tone }) {
  const map: Record<Tone, string> = { blue: "bg-blue-50 text-blue-700", green: "bg-emerald-500/10 text-emerald-300", amber: "bg-amber-500/10 text-amber-300", rose: "bg-rose-500/10 text-rose-300", slate: "bg-slate-800 text-slate-300" };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}>{children}</span>;
}
