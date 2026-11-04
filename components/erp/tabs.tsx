"use client";

import { useState, type ReactNode } from "react";

export function TabBar({ tabs, initial }: { tabs: { key: string; label: string; count?: number; content: ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial && tabs.some((tab) => tab.key === initial) ? initial : tabs[0]?.key);
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
            onClick={() => setActive(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${tab.key === current?.key ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}
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
