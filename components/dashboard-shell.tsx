"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Bell, Building2, ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldAlert, Store, UserCog, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { BrandLogo, BrandWordmark } from "@/components/branding";
import { minutesUntil } from "@/lib/format";
import { activeHref, NAVIGATION, type NavGroup, type NavItem } from "@/lib/navigation";
import { canAccessPath, canAny, isOutletScoped, isRole, ROLE_LABELS } from "@/lib/rbac";

// ---------------------------------------------------------------- collapsed sidebar preference (per browser)

const COLLAPSE_KEY = "pharm.sidebar.collapsed";
const collapseListeners = new Set<() => void>();
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    // storage unavailable (private mode): keep the in-memory choice only
  }
  collapseListeners.forEach((listener) => listener());
}
function useCollapsed() {
  return useSyncExternalStore(
    (listener) => {
      collapseListeners.add(listener);
      return () => collapseListeners.delete(listener);
    },
    readCollapsed,
    () => false,
  );
}

// ---------------------------------------------------------------- notices

function AccessDeniedNotice() {
  const params = useSearchParams();
  const denied = params.get("denied");
  if (!denied) return null;
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p>
        Your role does not have access to <span className="font-mono">{denied}</span>. Ask a Super Admin to update your permissions if you need it.
      </p>
    </div>
  );
}

/** Persistent, non-dismissable banner while a Super Administrator is acting as another user. */
export function ImpersonationBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const impersonation = session?.user.impersonation;
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!impersonation) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [impersonation]);
  const minutes = impersonation ? minutesUntil(impersonation.expiresAt) : 0;
  if (!impersonation || !session) return null;
  const roleLabel = isRole(session.user.role) ? ROLE_LABELS[session.user.role] : session.user.role;

  async function stop() {
    setBusy(true);
    await fetch("/api/impersonation", { method: "DELETE" }).catch(() => undefined);
    await update({ impersonate: null });
    setBusy(false);
    router.push("/users");
    router.refresh();
  }

  return (
    <div role="alert" className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-500 bg-amber-400 px-4 py-2 text-sm text-amber-950 print:hidden">
      <p className="flex items-center gap-2">
        <UserCog className="h-4 w-4 shrink-0" />
        <span>
          You are acting as <strong>{session.user.name}</strong> ({roleLabel}{session.user.staffId ? ` · ${session.user.staffId}` : ""}) on behalf of <strong>{impersonation.adminName}</strong>. Everything you do is recorded under both names.
          <span className="ml-2 text-amber-900/80">Ends automatically in {minutes} min.</span>
        </span>
      </p>
      <button type="button" disabled={busy} onClick={() => void stop()} className="rounded-lg bg-amber-950 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-60">
        {busy ? "Returning…" : "Return to Super Admin"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- notifications

type BellItem = { id: string; title: string; body: string; severity: string; link: string; createdAt: string; readAt?: string };
type NotificationData = { unread: number; items: BellItem[] };

function isNotificationData(value: unknown): value is NotificationData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return typeof data.unread === "number" && Array.isArray(data.items);
}

/** In-app notifications: polls every minute; opening an item marks it read. */
function NotificationBell() {
  const router = useRouter();
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationData>({ unread: 0, items: [] });

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    const load = () =>
      fetch("/api/notifications")
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (!cancelled && isNotificationData(payload)) setData(payload);
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status]);

  async function markRead(ids: string[] | "all") {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    if (response.ok) {
      const payload: unknown = await response.json();
      if (isNotificationData(payload)) setData(payload);
    }
  }

  const tone = (severity: string) => (severity === "critical" ? "bg-rose-500" : severity === "warning" ? "bg-amber-400" : "bg-sky-400");

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${data.unread} unread)`}>
        <Bell className="h-5 w-5" />
        {data.unread ? <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{data.unread > 99 ? "99+" : data.unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="font-semibold text-slate-900">Notifications</p>
            {data.unread ? <button type="button" onClick={() => void markRead("all")} className="text-xs font-medium text-blue-600 hover:underline">Mark all read</button> : null}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {data.items.length === 0 ? <li className="px-4 py-6 text-center text-sm text-slate-500">No notifications yet.</li> : null}
            {data.items.slice(0, 20).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!item.readAt) void markRead([item.id]);
                    setOpen(false);
                    router.push(item.link);
                  }}
                  className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 ${item.readAt ? "opacity-60" : ""}`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone(item.severity)}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{item.title}</span>
                    <span className="mt-0.5 block whitespace-pre-line text-xs text-slate-500">{item.body}</span>
                    <span className="mt-1 block text-[11px] text-slate-400">{new Date(item.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-blue-600 hover:bg-slate-50">View all notifications</Link>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- outlet context

/** Shows the working outlet; multi-outlet and central users may switch. The server re-validates every switch. */
/** The pharmacy this session works in; a menu when the account belongs to more than one. */
export function PharmacySwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = session?.user;
  if (!user?.tenantId) return null;
  const pharmacies = user.pharmacies ?? [];

  if (pharmacies.length <= 1) {
    return (
      <div className="flex max-w-56 items-center gap-1.5 truncate rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800" title="Pharmacy">
        <Building2 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{user.tenantName}</span>
      </div>
    );
  }

  async function change(next: string) {
    setBusy(true);
    setError(null);
    try {
      // The server switches only to a pharmacy this account is an active member of.
      const updated = await update({ tenantId: next });
      if (updated?.user.tenantId !== next) throw new Error("You no longer have access to that pharmacy.");
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cannot switch pharmacy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <label className="flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 py-0.5 pl-3 pr-1 text-xs font-medium text-emerald-800">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">Pharmacy</span>
        <select value={user.tenantId} disabled={busy} onChange={(event) => void change(event.target.value)} className="max-w-48 cursor-pointer truncate bg-transparent py-1 pr-1 outline-none">
          {pharmacies.map((pharmacy) => (
            <option key={pharmacy.id} value={pharmacy.id}>
              {pharmacy.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 shadow">{error}</p> : null}
    </div>
  );
}

export function OutletSwitcher() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = session?.user;
  if (!user) return null;

  const central = !isOutletScoped(user.role);
  const options = [...(central ? [{ id: "HQ", name: "All outlets (Head Office)" }] : []), ...(user.outlets ?? []).map((outlet) => ({ id: outlet.id, name: outlet.name }))];
  const current = user.outletId ?? "HQ";
  const label = options.find((option) => option.id === current)?.name ?? "Select outlet";

  if (options.length <= 1) {
    return (
      <div className="flex max-w-56 items-center gap-1.5 truncate rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800" title="Assigned outlet">
        <Store className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{label}</span>
      </div>
    );
  }

  async function change(next: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/session/outlet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outletId: next }) });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Cannot switch outlet.");
      const updated = await update({ outletId: next });
      if ((updated?.user.outletId ?? "HQ") !== next) throw new Error("Switch was refused by the server.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cannot switch outlet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <label className="flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 py-0.5 pl-3 pr-1 text-xs font-medium text-blue-800">
        <Store className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">Working outlet</span>
        <select value={current} disabled={busy} onChange={(event) => void change(event.target.value)} className="max-w-48 cursor-pointer truncate bg-transparent py-1 pr-1 outline-none">
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 shadow">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- global search

function GlobalSearch({ items, canSearchProducts, canSearchStockLevels, canSearchSales }: { items: NavItem[]; canSearchProducts: boolean; canSearchStockLevels: boolean; canSearchSales: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return [];
    const pages = items.filter((item) => `${item.name} ${item.keywords ?? ""}`.toLowerCase().includes(needle)).slice(0, 6).map((item) => ({ label: item.name, hint: "Go to page", href: item.href }));
    const records = [
      ...(canSearchProducts ? [{ label: `Products matching “${query.trim()}”`, hint: "Name, barcode, SKU or batch", href: `/products?q=${encodeURIComponent(query.trim())}` }] : []),
      ...(!canSearchProducts && canSearchStockLevels ? [{ label: `Stock left for “${query.trim()}”`, hint: "Quantity available", href: `/stock-levels?q=${encodeURIComponent(query.trim())}` }] : []),
      ...(canSearchSales ? [{ label: `Sales matching “${query.trim()}”`, hint: "Invoice, customer or cashier", href: `/sales?q=${encodeURIComponent(query.trim())}` }] : []),
    ];
    return [...pages, ...records];
  }, [needle, items, canSearchProducts, canSearchStockLevels, canSearchSales, query]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    input.current?.blur();
    router.push(href);
  }

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        ref={input}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results[0]) go(results[0].href);
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Search pages, products, sales…  ( / )"
        aria-label="Global search"
        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
      />
      {open && results.length ? (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {results.map((result) => (
            <li key={result.href}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => go(result.href)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50">
                <span className="text-slate-800">{result.label}</span>
                <span className="text-[11px] text-slate-400">{result.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- sidebar

function SidebarNav({ groups, current, collapsed, onNavigate }: { groups: NavGroup[]; current: string | null; collapsed: boolean; onNavigate?: () => void }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4" aria-label="Main navigation">
      {groups.map((group) => {
        const hasActive = group.items.some((item) => item.href === current);
        const isClosed = !collapsed && closed[group.label] && !hasActive;
        return (
          <div key={group.label}>
            {collapsed ? (
              <div className="mx-2 mb-2 border-t border-slate-100" />
            ) : (
              <button
                type="button"
                onClick={() => setClosed((value) => ({ ...value, [group.label]: !value[group.label] }))}
                className="mb-1 flex w-full items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 hover:text-slate-600"
                aria-expanded={!isClosed}
              >
                {group.label}
                <ChevronDown className={`h-3.5 w-3.5 transition ${isClosed ? "-rotate-90" : ""}`} />
              </button>
            )}
            {isClosed ? null : (
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = item.href === current;
                  const Icon = item.icon;
                  if (item.highlight) {
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.name : undefined}
                        className={`my-1 flex items-center gap-3 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-bold text-white shadow-sm shadow-blue-600/30 transition hover:bg-blue-700 ${active ? "ring-2 ring-blue-300 ring-offset-1" : ""} ${collapsed ? "justify-center px-0" : ""}`}
                      >
                        <Icon className="h-5 w-5 shrink-0 text-white" />
                        {collapsed ? <span className="sr-only">{item.name}</span> : item.name}
                      </Link>
                    );
                  }
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.name : undefined}
                      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${collapsed ? "justify-center px-0" : ""} ${
                        active ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      {active && !collapsed ? <span className="absolute -left-3 bottom-1.5 top-1.5 w-1 rounded-r-full bg-blue-600" /> : null}
                      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-blue-600" : "text-slate-400"}`} />
                      {collapsed ? <span className="sr-only">{item.name}</span> : <span className="truncate">{item.name}</span>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/dashboard" className={`flex h-20 items-center px-4 ${collapsed ? "justify-center px-0" : ""}`} aria-label="Dashboard">
      {collapsed ? <BrandLogo className="h-10 w-10" /> : <BrandWordmark className="h-16 w-auto max-w-full" />}
    </Link>
  );
}

function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const user = session?.user;
  const roleLabel = isRole(user?.role) ? ROLE_LABELS[user!.role as keyof typeof ROLE_LABELS] : "";
  const initials = (user?.name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-slate-100" aria-label="Account menu">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-sm font-semibold text-white">{initials}</span>
        <span className="hidden text-left lg:block">
          <span className="block max-w-36 truncate text-sm font-semibold text-slate-900">{user?.name ?? "…"}</span>
          <span className="block text-[11px] text-slate-500">{roleLabel}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 lg:block" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <p className="font-semibold text-slate-900">{user?.name}</p>
          <p className="text-xs text-slate-500">{roleLabel}{user?.staffId ? ` · ${user.staffId}` : ""}</p>
          <p className="mt-1 truncate text-xs text-slate-500">{user?.email}</p>
          <form action="/api/auth/signout" method="post" className="mt-3">
            <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- shell

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const { data: session, status } = useSession();
  const collapsed = useCollapsed();
  const [drawer, setDrawer] = useState(false);
  const user = session?.user;
  const subject = user ? { role: user.role, permissions: user.permissions ?? [] } : user;

  // Menu items follow the live permission list; pages and APIs enforce access again on the server.
  const groups = NAVIGATION.map((group) => ({ ...group, items: group.items.filter((item) => status === "loading" || (canAccessPath(subject, item.href) && (!item.requires || canAny(subject, item.requires)) && !(item.hiddenFor && canAny(subject, item.hiddenFor)))) })).filter((group) => group.items.length > 0);
  const flat = groups.flatMap((group) => group.items);
  const current = activeHref(flat, pathname, new URLSearchParams(search?.toString() ?? ""));
  const can = (href: string) => canAccessPath(subject, href);

  useEffect(() => {
    document.querySelector('aside [aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname, status]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <ImpersonationBanner />
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] md:flex print:!hidden ${collapsed ? "w-[76px]" : "w-64"}`}>
          <Brand collapsed={collapsed} />
          <SidebarNav groups={groups} current={current} collapsed={collapsed} />
        </aside>

        {/* Mobile drawer */}
        {drawer ? (
          <div className="fixed inset-0 z-50 md:hidden print:hidden">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
            <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-2xl">
              <div className="flex items-center justify-between pr-3">
                <Brand collapsed={false} />
                <button type="button" onClick={() => setDrawer(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close menu"><X className="h-5 w-5" /></button>
              </div>
              <SidebarNav groups={groups} current={current} collapsed={false} onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur md:gap-3 md:px-5 print:hidden">
            <button type="button" onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <button type="button" onClick={() => writeCollapsed(!collapsed)} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:block" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
            <GlobalSearch items={flat} canSearchProducts={can("/products")} canSearchStockLevels={can("/stock-levels")} canSearchSales={can("/sales")} />
            <div className="ml-auto flex items-center gap-1.5 md:gap-2">
              <div className="hidden items-center gap-1.5 sm:flex"><PharmacySwitcher /><OutletSwitcher /></div>
              <NotificationBell />
              {can("/settings") ? (
                <Link href="/settings" className="hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:block" aria-label="System settings"><Settings className="h-5 w-5" /></Link>
              ) : null}
              <UserMenu />
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2 sm:hidden print:hidden"><PharmacySwitcher /><OutletSwitcher /></div>

          <main className="theme-pharm min-w-0 flex-1 p-4 md:p-6">
            <AccessDeniedNotice />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-100" />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
