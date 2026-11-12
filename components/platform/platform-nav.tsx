"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Bell, Coins, BookOpen, Building2, CreditCard, FileClock, KeyRound, LayoutDashboard, LifeBuoy, Mail, Megaphone, Menu, MessageCircle, Palette, Plug, Receipt,
  ScrollText, Search, Server, ShieldAlert, ShieldCheck, ShieldHalf, UserCog, Users, X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

const ICONS = {
  dashboard: LayoutDashboard, pharmacies: Building2, support: LifeBuoy, announcements: Megaphone, help: BookOpen, plans: Receipt, payments: CreditCard, billing: BarChart3,
  email: Mail, whatsapp: MessageCircle, system: Server, branding: Palette, integrations: Plug, audit: ScrollText, securityLog: FileClock, securityPolicy: ShieldHalf, rateLimits: ShieldAlert, staff: UserCog, mySecurity: KeyRound, users: Users, ai: Coins,
} as const;
export type NavIcon = keyof typeof ICONS;
export type NavGroup = { label: string; links: { href: string; label: string; icon: NavIcon; badge?: number }[] };

function isActive(pathname: string, href: string) {
  return href === "/platform" ? pathname === "/platform" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The Control Centre frame: grouped sidebar (a drawer on phones) and the top bar. */
export function PlatformFrame({ groups, user, twoFactor, version, waiting, signOut, children }: {
  groups: NavGroup[]; user: { name: string; role: string; initials: string }; twoFactor: boolean; version: string; waiting: number; signOut: ReactNode; children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sidebar = (
    <nav className="flex h-full flex-col bg-gradient-to-b from-[#08361d] to-[#0b4a28] text-emerald-50" aria-label="Control Centre">
      <div className="flex items-center gap-3 px-5 py-5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-lime-400 to-emerald-600 text-lg font-black text-white">P</span>
        <div><p className="text-base font-bold text-white">PharmaERP</p><p className="text-xs text-emerald-100/70">Web365 Control Centre</p></div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/60">{group.label}</p>
            <ul className="space-y-0.5">
              {group.links.map((link) => {
                const Icon = ICONS[link.icon];
                const active = isActive(pathname, link.href);
                return (
                  <li key={link.href}>
                    <Link href={link.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-gradient-to-r from-blue-600 to-blue-500 font-semibold text-white shadow-lg shadow-black/25" : "text-emerald-50/85 hover:bg-white/5 hover:text-white"}`}>
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="flex-1">{link.label}</span>
                      {link.badge ? <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-slate-900">{link.badge}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="m-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
        <ShieldCheck className={`mx-auto h-8 w-8 ${twoFactor ? "text-emerald-400" : "text-amber-300"}`} />
        <p className="mt-2 text-sm font-semibold text-white">{twoFactor ? "Signed in with two-factor" : "Protect your account"}</p>
        <p className="text-xs text-emerald-100/70">{twoFactor ? "Your session is verified." : "Turn on two-factor sign-in."}</p>
        <Link href="/platform/security" className="mt-3 inline-block rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">My security →</Link>
      </div>
      <p className="px-5 pb-4 text-[11px] text-emerald-200/60">PharmaERP v{version}</p>
    </nav>
  );
  return (
    <div className="theme-green min-h-screen bg-[#f3f7f4] text-slate-900" data-platform-shell>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72">{sidebar}</aside>
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute left-72 top-3 ml-2 rounded-lg bg-white p-2"><X className="h-5 w-5" /></button>
        </div>
      ) : null}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
          <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><Menu className="h-5 w-5" /></button>
          <form action="/platform/tenants" method="get" className="relative hidden max-w-md flex-1 sm:block" role="search">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input name="q" placeholder="Search pharmacies by name, slug or email…" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white" />
          </form>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/platform/tickets" aria-label={`${waiting} tickets waiting for a reply`} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100">
              <Bell className="h-5 w-5" />
              {waiting ? <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">{waiting}</span> : null}
            </Link>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-600 text-sm font-bold text-white">{user.initials}</span>
              <div className="hidden leading-tight sm:block"><p className="text-sm font-semibold">{user.name}</p><p className="text-xs text-slate-500">{user.role}</p></div>
            </div>
            {signOut}
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
