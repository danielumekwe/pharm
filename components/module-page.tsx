import type { ReactNode } from "react";
import { ArrowUpRight, Download, PlusCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type SummaryCard = {
  title: string;
  value: string;
  note: string;
  tone?: "emerald" | "amber" | "rose" | "sky";
};

export type ModuleRow = {
  label: string;
  meta: string;
  value: string;
  status?: "Approved" | "Pending" | "Review" | "Healthy" | "Alert";
};

export function ModulePage({
  title,
  description,
  summary,
  actions,
  rows,
  children,
}: {
  title: string;
  description: string;
  summary: SummaryCard[];
  actions?: { label: string; tone?: "primary" | "secondary" }[];
  rows: ModuleRow[];
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-emerald-300">Operations module</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {actions?.map((action) => (
            <Button
              key={action.label}
              variant={action.tone === "secondary" ? "outline" : "default"}
              className={
                action.tone === "secondary"
                  ? "border-slate-700 bg-slate-950 text-slate-100"
                  : "bg-emerald-500 hover:bg-emerald-400"
              }
            >
              {action.label === "New transaction" ? <PlusCircle className="mr-2 h-4 w-4" /> : null}
              {action.label === "Export report" ? <Download className="mr-2 h-4 w-4" /> : null}
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summary.map(({ title: cardTitle, value, note, tone = "emerald" }) => (
          <Card key={cardTitle} className="border-slate-800 bg-slate-900/70">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-slate-300">
                <p className="text-sm">{cardTitle}</p>
                <div
                  className={
                    tone === "emerald"
                      ? "rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-300"
                      : tone === "amber"
                        ? "rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300"
                        : tone === "rose"
                          ? "rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300"
                          : "rounded-lg border border-sky-500/30 bg-sky-500/10 p-2 text-sky-300"
                  }
                >
                  <ArrowUpRight className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-4 text-2xl font-semibold text-white">{value}</p>
              <p className="mt-2 text-xs text-slate-400">{note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {children ? <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">{children}</div> : null}

      <Card className="border-slate-800 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="text-lg text-white">Operational queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div>
                  <p className="text-sm font-medium text-white">{row.label}</p>
                  <p className="text-xs text-slate-400">{row.meta}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-200">{row.value}</p>
                  {row.status ? (
                    <Badge
                      variant="secondary"
                      className={
                        row.status === "Approved" || row.status === "Healthy"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : row.status === "Pending" || row.status === "Review"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                            : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                      }
                    >
                      {row.status}
                    </Badge>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
