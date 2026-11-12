import type { ReactNode } from "react";

import packageJson from "@/package.json";
import { platformQuery } from "@/lib/db/database";
import { PLATFORM_ROLE_LABELS, platformCan, type PlatformActor, type PlatformPermission } from "@/lib/platform/session";

import { PlatformFrame, type NavGroup, type NavIcon } from "./platform-nav";
import { PlatformSignOut } from "./platform-sign-out";

type Link = { href: string; label: string; icon: NavIcon; permission: PlatformPermission | "self" };
const GROUPS: Array<{ label: string; links: Link[] }> = [
  { label: "Overview", links: [{ href: "/platform", label: "Dashboard", icon: "dashboard", permission: "dashboard.view" }] },
  { label: "Customers", links: [
    { href: "/platform/tenants", label: "Pharmacies", icon: "pharmacies", permission: "tenants.view" },
    { href: "/platform/tickets", label: "Support tickets", icon: "support", permission: "support.tickets" },
    { href: "/platform/announcements", label: "Announcements", icon: "announcements", permission: "content.manage" },
    { href: "/platform/help", label: "Help articles", icon: "help", permission: "content.manage" },
  ] },
  { label: "Billing", links: [
    { href: "/platform/plans", label: "Plans", icon: "plans", permission: "plans.manage" },
    { href: "/platform/settings/payments", label: "Payment gateway", icon: "payments", permission: "billing.manage" },
    { href: "/platform/settings/billing", label: "Billing policy", icon: "billing", permission: "billing.manage" },
    { href: "/platform/ai", label: "AI Usage & Billing", icon: "ai", permission: "ai.view" },
  ] },
  { label: "Platform", links: [
    { href: "/platform/settings/email", label: "Email", icon: "email", permission: "settings.manage" },
    { href: "/platform/settings/whatsapp", label: "WhatsApp", icon: "whatsapp", permission: "settings.manage" },
    { href: "/platform/settings/system", label: "System", icon: "system", permission: "settings.manage" },
    { href: "/platform/settings/general", label: "Branding", icon: "branding", permission: "settings.manage" },
    { href: "/platform/integrations", label: "Integrations", icon: "integrations", permission: "settings.manage" },
  ] },
  { label: "Security", links: [
    { href: "/platform/audit", label: "Audit log", icon: "audit", permission: "audit.view" },
    { href: "/platform/security/log", label: "Security log", icon: "securityLog", permission: "audit.view" },
    { href: "/platform/security/rate-limits", label: "Rate Limits & API Protection", icon: "rateLimits", permission: "rateLimits.manage" },
    { href: "/platform/settings/security", label: "Security policy", icon: "securityPolicy", permission: "staff.manage" },
    { href: "/platform/staff", label: "Platform staff", icon: "staff", permission: "staff.manage" },
    { href: "/platform/security", label: "My security", icon: "mySecurity", permission: "self" },
  ] },
];

/** Layout for Web365 platform administration: separate from the pharmacy app. */
export async function PlatformShell({ actor, children }: { actor: PlatformActor; children: ReactNode }) {
  // Tickets where the pharmacy wrote last and Web365 has not answered (the bell badge).
  const waiting = platformCan(actor, "support.tickets") && !actor.pending
    ? Number((await platformQuery<Array<{ n: string }>>((query) => query(`SELECT count(*) AS n FROM support_tickets WHERE status IN ('OPEN', 'IN_PROGRESS') AND last_reply_by = 'pharmacy'`)).catch(() => [{ n: "0" }]))[0]?.n ?? 0)
    : 0;
  const groups: NavGroup[] = GROUPS.map((group) => ({
    label: group.label,
    links: group.links
      .filter((link) => (actor.pending ? link.href === "/platform/security" : link.permission === "self" || platformCan(actor, link.permission)))
      .map((link) => ({ href: link.href, label: link.label, icon: link.icon, badge: link.href === "/platform/tickets" ? waiting : undefined })),
  })).filter((group) => group.links.length);
  const initials = actor.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <PlatformFrame groups={groups} user={{ name: actor.name, role: PLATFORM_ROLE_LABELS[actor.role], initials }} twoFactor={Boolean(actor.twoFactor)} version={packageJson.version} waiting={waiting} signOut={<PlatformSignOut />}>
      {children}
    </PlatformFrame>
  );
}
