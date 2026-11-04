import type { ReactNode } from "react";

export function PageHeader({
  eyebrow = "Operations module",
  title,
  description,
  actions,
  scope,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  /** Shown as a chip, e.g. the outlet a scoped user is limited to. */
  scope?: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-l-4 border-slate-800 border-l-lime-400 bg-slate-900/70 p-5 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-300">{eyebrow}</p>
          {scope ? (
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">{scope}</span>
          ) : null}
        </div>
        <h3 className="mt-2 text-2xl font-bold text-white">{title}</h3>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
