// Presentation helpers for the pharmacy console (server-safe: no state, no browser APIs).
import type { ReactNode } from "react";

type Tone = "green" | "blue" | "amber" | "red" | "slate" | "violet";

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

/** One badge style everywhere; the tone follows the meaning of the status. */
export function Badge({ tone = "slate", children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: "green", SUCCESS: "green", APPROVED: "green", PROCESSED: "green", OPEN: "green", PAID: "green",
  TRIAL: "blue", PENDING: "amber", REQUESTED: "amber", GRACE: "amber", PAST_DUE: "amber", INVITED: "amber",
  SUSPENDED: "red", FAILED: "red", REJECTED: "red", DECLINED: "red", EXPIRED: "red", CANCELLED: "slate", CLOSED: "slate", DEACTIVATED: "slate", REVOKED: "slate", USED: "slate",
};

const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^./, (first) => first.toUpperCase());

export function StatusBadge({ status, dot = true }: { status: string | null | undefined; dot?: boolean }) {
  if (!status) return <Badge>None</Badge>;
  return <Badge tone={STATUS_TONES[status.toUpperCase()] ?? "slate"} dot={dot}>{label(status)}</Badge>;
}

/** A plain panel: white, hairline border, soft shadow. Optional header with actions on the right. */
export function Panel({ title, description, actions, children, className = "", flush = false, ...rest }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`} {...rest}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "" : "px-5 py-4"}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}

/** Label/value pairs in two columns on wide screens. */
export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {rows.map(([name, value]) => (
        <div key={name} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{name}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact table styles shared by every list on the page. */
export const table = {
  wrap: "overflow-x-auto",
  table: "w-full min-w-[560px] text-sm",
  head: "border-b border-slate-200 bg-slate-50/70 text-left text-xs font-medium uppercase tracking-wide text-slate-500",
  th: "px-4 py-2.5 font-medium",
  body: "divide-y divide-slate-100",
  td: "px-4 py-2.5 align-top text-slate-700",
};

export const button = {
  primary: "inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50",
  secondary: "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50",
  danger: "inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50",
  success: "inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50",
};
