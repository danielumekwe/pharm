import type { LucideIcon } from "lucide-react";

export type Tone = "emerald" | "amber" | "rose" | "sky" | "slate";

const toneClasses: Record<Tone, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  slate: "border-slate-600/40 bg-slate-700/20 text-slate-300",
};

export function toneClass(tone: Tone) {
  return toneClasses[tone];
}

export type Stat = { label: string; value: string; note?: string; tone?: Tone; icon?: LucideIcon };

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(({ label, value, note, tone = "emerald", icon: Icon }) => (
        <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-300">{label}</p>
            {Icon ? (
              <div className={`rounded-lg border p-2 ${toneClasses[tone]}`}>
                <Icon className="h-4 w-4" />
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-2xl font-semibold text-white tabular-nums">{value}</p>
          {note ? <p className="mt-1 text-xs text-slate-400">{note}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function Panel({ title, description, actions, children, className = "" }: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-800 bg-slate-900/70 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div>
          <h4 className="text-base font-semibold text-white">{title}</h4>
          {description ? <p className="mt-0.5 text-xs text-slate-400">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
