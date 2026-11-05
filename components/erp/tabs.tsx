"use client";

import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

/** Tabs. `?tab=<key>` in the URL (e.g. from a sidebar link) selects a tab; clicking a tab overrides it. */
export function TabBar({ tabs, initial }: { tabs: { key: string; label: string; count?: number; content: ReactNode }[]; initial?: string }) {
  const fromUrl = useSearchParams()?.get("tab") ?? null;
  const [chosen, setChosen] = useState<{ key: string; url: string | null } | null>(null);
  const valid = (key: string | null | undefined) => (key && tabs.some((tab) => tab.key === key) ? key : undefined);
  // A new ?tab= (navigating from the sidebar) wins over an earlier click.
  const active = (chosen && chosen.url === fromUrl ? valid(chosen.key) : undefined) ?? valid(fromUrl) ?? valid(initial) ?? tabs[0]?.key;
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={tab.key === current?.key}
            onClick={() => setChosen({ key: tab.key, url: fromUrl })}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${tab.key === current?.key ? "bg-slate-900 font-medium text-white shadow-sm" : "text-slate-400 hover:text-white"}`}
          >
            {tab.label}
            {tab.count !== undefined ? <span className="ml-2 rounded-full bg-slate-700/60 px-1.5 text-[11px] text-slate-300">{tab.count}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current?.content}</div>
    </div>
  );
}
