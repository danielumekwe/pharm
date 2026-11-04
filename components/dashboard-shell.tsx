"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  BarChart3,
  Bell,
  BellRing,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  HandCoins,
  Handshake,
  KeyRound,
  Landmark,
  LogOut,
  Mail,
  MessageSquareText,
  PackageSearch,
  ReceiptText,
  Settings,
  ShieldAlert,
  LineChart,
  UserCog,
  Store,
  ShoppingCart,
  UserRound,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import { BrandMark } from "@/components/brand-logo";
import { minutesUntil } from "@/lib/format";
import { canAccessPath, isOutletScoped, isRole, ROLE_LABELS } from "@/lib/rbac";

const navigationGroups = [
  {
    label: "Core",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: BarChart3 },
      { name: "Contacts", href: "/contacts", icon: Users },
      { name: "Sale", href: "/sales", icon: ShoppingCart },
      { name: "Sales overview", href: "/sales-overview", icon: LineChart },
      { name: "Purchase", href: "/purchase", icon: ReceiptText },
      { name: "Items", href: "/products", icon: Boxes },
      { name: "Stock", href: "/stock", icon: Warehouse },
      { name: "Alerts centre", href: "/alerts", icon: BellRing },
      { name: "Batches & GRN", href: "/inventory", icon: PackageSearch },
      { name: "Expense", href: "/finance", icon: HandCoins },
    ],
  },
  {
    label: "Add-ons",
    items: [
      { name: "Partners", href: "/partners", icon: Handshake },
      { name: "Repairs", href: "/repairs", icon: Wrench },
      { name: "SMS", href: "/sms", icon: MessageSquareText },
      { name: "Email", href: "/email", icon: Mail },
    ],
  },
  {
    label: "Management",
    items: [
      { name: "Cash & Bank", href: "/billing", icon: CreditCard },
      { name: "Warehouses", href: "/outlets", icon: Building2 },
      { name: "Utilities", href: "/settings", icon: Settings },
      { name: "Staff & users", href: "/users", icon: UserRound },
      { name: "Roles & permissions", href: "/permissions", icon: KeyRound },
      { name: "Reports", href: "/reports", icon: ClipboardList },
      { name: "Regulatory", href: "/regulatory", icon: Landmark },
      { name: "Audit", href: "/audit", icon: FileText },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AccessDeniedNotice() {
  const params = useSearchParams();
  const denied = params.get("denied");
  if (!denied) return null;
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <p>
        Your role does not have access to <span className="font-mono text-amber-200">{denied}</span>. Ask a Super Admin to update your permissions if you need it.
      </p>
    </div>
  );
}

/** Persistent, non-dismissable banner while a Super Administrator is acting as another user. */
function ImpersonationBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const impersonation = session?.user.impersonation;
  const [busy, setBusy] = useState(false);
  // Re-render every 30 s so the countdown stays current.
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
    <div role="alert" className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-500 bg-amber-400 px-4 py-2 text-sm text-amber-950 print:hidden">
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
      <button type="button" onClick={() => setOpen((value) => !value)} className="relative rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-200 hover:bg-slate-800" aria-label={`Notifications (${data.unread} unread)`}>
        <Bell className="h-4 w-4" />
        {data.unread ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-5 text-white">{data.unread > 99 ? "99+" : data.unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <p className="font-semibold text-white">Notifications</p>
            {data.unread ? <button type="button" onClick={() => void markRead("all")} className="text-xs font-medium text-emerald-300 hover:underline">Mark all read</button> : null}
          </div>
          <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
            {data.items.length === 0 ? <li className="px-4 py-6 text-center text-sm text-slate-500">No notifications yet.</li> : null}
            {data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!item.readAt) void markRead([item.id]);
                    setOpen(false);
                    router.push(item.link);
                  }}
                  className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-800/50 ${item.readAt ? "opacity-60" : ""}`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone(item.severity)}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white">{item.title}</span>
                    <span className="mt-0.5 block whitespace-pre-line text-xs text-slate-400">{item.body}</span>
                    <span className="mt-1 block text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/alerts" onClick={() => setOpen(false)} className="block border-t border-slate-800 px-4 py-2.5 text-center text-sm font-medium text-emerald-300 hover:bg-slate-800/50">Open alerts centre</Link>
        </div>
      ) : null}
    </div>
  );
}

/** Lets multi-outlet and central users change their working outlet. The server re-validates every switch. */
function OutletSwitcher({ compact = false }: { compact?: boolean }) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = session?.user;
  if (!user) return null;

  const central = !isOutletScoped(user.role);
  const options = [
    ...(central ? [{ id: "HQ", name: "All outlets (Head Office)" }] : []),
    ...(user.outlets ?? []).map((outlet) => ({ id: outlet.id, name: outlet.name })),
  ];
  const current = user.outletId ?? "HQ";
  const label = options.find((option) => option.id === current)?.name ?? "Select outlet";

  if (options.length <= 1) {
    return (
      <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${compact ? "border-white/25 bg-white/10 text-white" : "border-green-600/30 bg-green-50 text-green-800"}`}>
        <Store className="h-3.5 w-3.5" /> {label}
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
      <label className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-3 pr-1 text-xs font-medium ${compact ? "border-white/25 bg-white/10 text-white" : "border-green-600/30 bg-green-50 text-green-800"}`}>
        <Store className="h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">Working outlet</span>
        <select
          value={current}
          disabled={busy}
          onChange={(event) => void change(event.target.value)}
          className={`max-w-48 cursor-pointer truncate rounded-full bg-transparent py-1 pr-1 outline-none ${compact ? "text-white [&>option]:text-slate-900" : ""}`}
        >
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

function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action="/api/auth/signout" method="post" className={compact ? "md:hidden" : "mt-3"}>
      <button
        type="submit"
        className={`flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/20 ${compact ? "" : "w-full"}`}
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </form>
  );
}

// Same backdrop as the welcome screen's left panel.
const sidebarBackdrop = {
  backgroundImage:
    "radial-gradient(ellipse 80% 30% at 0% 100%, rgba(163,230,53,0.18), transparent 70%), linear-gradient(170deg, #0a4d29 0%, #0d6a33 55%, #12813c 100%)",
};

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { data: session, status } = useSession();
  const user = session?.user;
  const role = user?.role;
  const roleLabel = isRole(role) ? ROLE_LABELS[role] : status === "loading" ? "Loading…" : "Guest";
  const outlet = user?.outletId ? (user.outlets ?? []).find((row) => row.id === user.outletId) ?? null : null;

  // Keep the current module visible when the sidebar menu is taller than the screen.
  useEffect(() => {
    document.querySelector('aside [aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname, status]);

  // While the session loads, show the full menu to avoid layout flicker; the proxy and pages enforce access.
  // Menu visibility uses the live permission list from the session; pages and APIs enforce it again server-side.
  const subject = user ? { role: user.role, permissions: user.permissions ?? [] } : role;
  const groups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => status === "loading" || canAccessPath(subject, item.href)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-[#eef3f0] text-slate-900">
      <div className="flex min-h-screen">
        <aside
          className="sticky top-0 hidden h-screen w-72 print:!hidden shrink-0 flex-col border-r-4 border-lime-400 p-5 text-white md:flex"
          style={sidebarBackdrop}
        >
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-xl bg-white p-1 shadow-md">
              <BrandMark id="sidebar" className="h-10 w-10" />
            </div>
            <div>
              <p className="text-lg font-bold leading-tight tracking-tight">Pharmacy ERP</p>
              <p className="text-[11px] text-emerald-50/75">Management &amp; ERP System</p>
            </div>
          </div>

          <nav className="-mr-2 flex-1 space-y-4 overflow-y-auto pr-2">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-50/55">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map(({ name, href, icon: Icon }) => {
                    const active = isActive(pathname, href);
                    return (
                      <Link
                        key={name}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={`relative flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm transition ${
                          active
                            ? "bg-white font-semibold text-green-800 shadow-sm"
                            : "text-emerald-50/90 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {active ? <span className="absolute -left-5 top-1.5 bottom-1.5 w-1 rounded-r-full bg-lime-400" /> : null}
                        <Icon className={`h-4 w-4 ${active ? "text-green-700" : ""}`} />
                        {name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-3 rounded-2xl border border-white/20 bg-white/10 p-3.5 backdrop-blur-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-50/60">Signed in</p>
            <p className="mt-1.5 truncate text-base font-semibold">{user?.name ?? "…"}</p>
            <p className="text-sm text-emerald-50/80">{roleLabel}</p>
            <p className="mt-1 truncate text-xs text-lime-200">{outlet ? outlet.name : "Head Office · All outlets"}</p>
            {user?.staffId ? <p className="truncate font-mono text-[11px] text-emerald-50/60">{user.staffId}</p> : null}
            <SignOutButton />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <ImpersonationBanner />
          <div className="flex items-center gap-3 border-b-4 border-lime-400 px-4 py-3 text-white md:hidden print:hidden" style={sidebarBackdrop}>
            <div className="rounded-lg bg-white p-0.5">
              <BrandMark id="mobile" className="h-8 w-8" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold leading-tight">Pharmacy ERP</p>
              <p className="truncate text-[11px] text-emerald-50/80">{user?.name ?? "…"} · {roleLabel}</p>
              <div className="mt-1"><OutletSwitcher compact /></div>
            </div>
            <SignOutButton compact />
          </div>

          <div className="theme-pharm p-4 md:p-8">
          <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-700">Operations</p>
              <h2 className="mt-1 text-xl font-bold text-white md:text-2xl">Pharmacy management center</h2>
              <span className="mt-1.5 block h-1 w-16 rounded-full bg-lime-400" />
            </div>
            <div className="flex items-center gap-2">
              <OutletSwitcher />
              <NotificationBell />
              <div className="hidden rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-sm font-medium text-slate-200 md:block">{roleLabel}</div>
            </div>
          </div>

          <nav className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden print:hidden" aria-label="Modules">
            {groups.flatMap((group) => group.items).map(({ name, href, icon: Icon }) => (
              <Link
                key={name}
                href={href}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                  isActive(pathname, href) ? "border-green-700 bg-green-700 text-white" : "border-slate-700 bg-slate-900 text-slate-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {name}
              </Link>
            ))}
          </nav>

          <Suspense fallback={null}>
            <AccessDeniedNotice />
          </Suspense>

          {children}
          </div>
        </main>
      </div>
    </div>
  );
}
