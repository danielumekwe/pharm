"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { TABS, type TabId } from "./tabs";
import { button, StatusBadge, table } from "./ui";



/** Switch tab from anywhere on the page (stat tiles, header menu). */
export function goToTab(tab: TabId) {
  window.dispatchEvent(new CustomEvent("tenant-tab", { detail: tab }));
}

/**
 * Tabbed sections. Every panel is rendered on the server and only hidden here, so nothing is fetched twice and
 * the page works without JavaScript; the open tab is kept in ?tab= for links and reloads.
 */
export function TenantTabs({ initial, panels, counts }: { initial: TabId; panels: Record<TabId, ReactNode>; counts?: Partial<Record<TabId, number>> }) {
  const [active, setActive] = useState<TabId>(initial);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onTab = (event: Event) => {
      const tab = (event as CustomEvent<TabId>).detail;
      setActive(tab);
      bar.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("tenant-tab", onTab);
    return () => window.removeEventListener("tenant-tab", onTab);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (active === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", active);
    window.history.replaceState(null, "", url);
  }, [active]);
  return (
    <div className="mt-6">
      <div ref={bar} className="scroll-mt-4 border-b border-slate-200">
        <nav role="tablist" aria-label="Pharmacy sections" className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={active === id}
              aria-controls={`panel-${id}`}
              onClick={() => setActive(id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active === id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>
              {name}
              {counts?.[id] ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{counts[id]}</span> : null}
            </button>
          ))}
        </nav>
      </div>
      {TABS.map(([id]) => (
        <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={active !== id} className="pt-6">
          {panels[id]}
        </div>
      ))}
    </div>
  );
}

/** A clickable overview tile that opens a tab. */
export function StatTile({ tab, label, value, detail, tone = "slate" }: { tab: TabId; label: string; value: string; detail: string; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const accent = { slate: "text-slate-900", green: "text-emerald-700", amber: "text-amber-700", red: "text-rose-700", blue: "text-sky-700" }[tone];
  return (
    <button type="button" onClick={() => goToTab(tab)} className="group flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-slate-300 hover:shadow">
      <span className="flex items-center justify-between text-xs font-medium text-slate-500">
        {label}
        <span aria-hidden="true" className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">→</span>
      </span>
      <span className={`mt-1 truncate text-xl font-semibold ${accent}`}>{value}</span>
      <span className="mt-0.5 truncate text-xs text-slate-500">{detail}</span>
    </button>
  );
}

/** Header actions: Edit details, and a menu that jumps to the section holding each action. */
export function HeaderActions({ canEdit, items }: { canEdit: boolean; items: Array<{ label: string; tab: TabId; danger?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit ? (
        <button type="button" className={button.secondary} onClick={() => { goToTab("overview"); window.dispatchEvent(new Event("tenant-edit")); }}>Edit details</button>
      ) : null}
      {items.length ? (
        <div ref={menu} className="relative">
          <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={button.secondary}>
            Actions <span aria-hidden="true" className="text-slate-400">▾</span>
          </button>
          {open ? (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {items.map((item) => (
                <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); goToTab(item.tab); }} className={`block w-full px-3.5 py-2 text-left text-sm hover:bg-slate-50 ${item.danger ? "text-rose-700" : "text-slate-700"}`}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type Person = { user_id: string; name: string; email: string; email_verified_at: string | null; role: string; status: string; last_login: string | null };

/** Staff accounts with search and role/status filters. */
export function PeopleTable({ people }: { people: Person[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const roles = useMemo(() => [...new Set(people.map((person) => person.role))].sort(), [people]);
  const statuses = useMemo(() => [...new Set(people.map((person) => person.status))].sort(), [people]);
  const rows = people.filter((person) => {
    const q = query.trim().toLowerCase();
    return (!q || person.name.toLowerCase().includes(q) || person.email.toLowerCase().includes(q)) && (!role || person.role === role) && (!status || person.status === status);
  });
  const pretty = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^./, (first) => first.toUpperCase());
  const control = "h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200";
  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3">
        <input type="search" aria-label="Search staff" placeholder="Search name or email" value={query} onChange={(event) => setQuery(event.target.value)} className={`${control} min-w-0 flex-1 sm:max-w-xs`} />
        <select aria-label="Filter by role" value={role} onChange={(event) => setRole(event.target.value)} className={control}><option value="">All roles</option>{roles.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select>
        <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)} className={control}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select>
      </div>
      <div className={table.wrap}>
        <table className={table.table} data-tenant-people>
          <thead className={table.head}><tr><th className={table.th}>Name</th><th className={table.th}>Email</th><th className={table.th}>Role</th><th className={table.th}>Status</th><th className={table.th}>Last sign-in (UTC)</th></tr></thead>
          <tbody className={table.body}>
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">{people.length ? "No staff match these filters." : "No staff accounts."}</td></tr> : rows.map((person) => (
              <tr key={person.user_id} className="hover:bg-slate-50/60">
                <td className={`${table.td} font-medium text-slate-900`}>{person.name}</td>
                <td className={`${table.td} break-all`}>{person.email}{person.email_verified_at ? null : <span className="ml-1.5 text-xs text-amber-700">unconfirmed</span>}</td>
                <td className={table.td}>{pretty(person.role)}</td>
                <td className={table.td}><StatusBadge status={person.status} /></td>
                <td className={`${table.td} whitespace-nowrap`}>{person.last_login ? person.last_login.replace("T", " ").slice(0, 16) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A text link that opens another tab. */
export function TabLink({ tab, children }: { tab: TabId; children: ReactNode }) {
  return <button type="button" onClick={() => goToTab(tab)} className="text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 hover:decoration-slate-900">{children}</button>;
}
