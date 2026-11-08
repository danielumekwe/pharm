"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { NAV_LINKS } from "./content";

type Props = { logo: ReactNode; cta: { label: string; href: string }; signedIn: boolean };

/** Sticky landing-page header: section links with the current section marked, and a drawer on small screens. */
export function SiteNav({ logo, cta, signedIn }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("top");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const sections = NAV_LINKS.map((link) => document.getElementById(link.id)).filter((node): node is HTMLElement => Boolean(node));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => {
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const account = signedIn ? { label: "Dashboard", href: "/dashboard" } : { label: "Login", href: "/login" };

  return (
    <header className={`sticky top-0 z-40 border-b bg-white/90 backdrop-blur transition-colors ${scrolled ? "border-slate-200 shadow-[0_1px_12px_rgba(15,42,82,0.06)]" : "border-transparent"}`}>
      <nav aria-label="Main" className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <a href="#top" className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-blue" aria-label="PharmaERP home">{logo}</a>

        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.id}>
              <a
                href={`#${link.id}`}
                aria-current={active === link.id ? "true" : undefined}
                className={`relative rounded-md px-3 py-2 text-[15px] font-medium transition-colors hover:text-brand-blue ${active === link.id ? "text-brand-blue" : "text-brand-ink/80"}`}
              >
                {link.label}
                <span aria-hidden="true" className={`absolute inset-x-3 -bottom-[1.1rem] h-0.5 rounded-full bg-brand-blue transition-opacity ${active === link.id ? "opacity-100" : "opacity-0"}`} />
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-3 lg:flex">
          <Link href={account.href} className="rounded-lg px-4 py-2.5 text-[15px] font-semibold text-brand-navy hover:bg-brand-sky">{account.label}</Link>
          <Link href={cta.href} className="rounded-lg bg-brand-blue px-5 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-brand-blue-dark">{cta.label}</Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="landing-drawer"
          aria-label="Open menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-brand-navy lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="landing-drawer">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-brand-navy/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(20rem,85vw)] flex-col bg-white shadow-2xl">
            <div className="flex h-[4.5rem] items-center justify-between border-b border-slate-100 px-4">
              <span className="text-sm font-semibold text-brand-muted">Menu</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-brand-navy hover:bg-brand-sky">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto px-2 py-3">
              {NAV_LINKS.map((link) => (
                <li key={link.id}>
                  <a
                    href={`#${link.id}`}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-3 text-base font-medium ${active === link.id ? "bg-brand-sky text-brand-blue" : "text-brand-ink hover:bg-slate-50"}`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="grid gap-2 border-t border-slate-100 p-4">
              <Link href={cta.href} className="rounded-lg bg-brand-blue px-4 py-3 text-center font-semibold text-white hover:bg-brand-blue-dark">{cta.label}</Link>
              <Link href={account.href} className="rounded-lg border border-slate-200 px-4 py-3 text-center font-semibold text-brand-navy hover:bg-brand-sky">{account.label}</Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
