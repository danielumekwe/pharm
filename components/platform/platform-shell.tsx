import Link from "next/link";
import type { ReactNode } from "react";

import { BrandWordmark } from "@/components/branding";
import { PLATFORM_ROLE_LABELS, platformCan, type PlatformActor } from "@/lib/platform/session";

import { PlatformSignOut } from "./platform-sign-out";

/** Layout for Web365 platform administration: separate from the pharmacy app. */
export function PlatformShell({ actor, children }: { actor: PlatformActor; children: ReactNode }) {
  const links = [
    { href: "/platform", label: "Pharmacies", show: true },
    { href: "/platform/plans", label: "Plans", show: platformCan(actor, "plans.manage") },
    { href: "/platform/audit", label: "Audit log", show: platformCan(actor, "audit.view") },
    { href: "/platform/staff", label: "Platform staff", show: platformCan(actor, "staff.manage") },
  ];
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900" data-platform-shell>
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-white px-2 py-1"><BrandWordmark className="h-7 w-auto" /></span>
            <span className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Web365 platform</span>
          </div>
          <nav className="flex flex-1 flex-wrap gap-1 text-sm">
            {links.filter((link) => link.show).map((link) => (
              <Link key={link.href} href={link.href} className="rounded-md px-3 py-1.5 text-slate-200 hover:bg-white/10 hover:text-white">{link.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">{actor.name} · {PLATFORM_ROLE_LABELS[actor.role]}</span>
            <PlatformSignOut />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
