"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/marketing/logo";
import { links, navLinks, type Cta } from "@/components/marketing/site";

export function Navbar({ cta, signedIn, notice }: { cta: Cta; signedIn: boolean; notice?: string | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // Highlight the nav link of the section in view (template behaviour).
    const sections = navLinks
      .map((link) => document.querySelector<HTMLElement>(link.href))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(`#${entry.target.id}`);
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
    const onResize = () => window.innerWidth >= 1024 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const solid = scrolled || open;
  const account = signedIn ? { label: "Dashboard", href: links.dashboard } : { label: "Sign in", href: links.login };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        solid ? "border-b border-brand-100/70 bg-white/85 shadow-sm backdrop-blur-xl" : "bg-transparent"
      }`}
    >
      {notice ? (
        <div role="alert" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900" data-maintenance-banner>
          {notice}
        </div>
      ) : null}
      <nav aria-label="Main" className={`container-x flex items-center justify-between transition-all duration-300 ${scrolled ? "h-[70px]" : "h-20"}`}>
        <a href="#top" aria-label="PharmaERP home" className="shrink-0">
          <Logo className="h-9 w-auto sm:h-10" preload />
        </a>

        <ul className="hidden items-center gap-1 lg:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                aria-current={active === link.href ? "true" : undefined}
                className={`rounded-full px-4 py-2 text-[0.9375rem] font-medium transition-colors ${
                  active === link.href ? "bg-brand-50 text-brand-700" : "text-lp-ink-soft hover:text-brand-700"
                }`}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-3 lg:flex">
          <a href={account.href} className="btn btn-secondary btn-sm">{account.label}</a>
          <a href={cta.href} className="btn btn-primary btn-sm">{cta.label}</a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="grid size-11 place-items-center rounded-full text-lp-ink hover:bg-brand-50 lg:hidden"
        >
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </nav>

      <div id="mobile-menu" hidden={!open} className="border-t border-brand-100 bg-white lg:hidden">
        <ul className="container-x flex flex-col py-3">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-base font-medium text-lp-ink-soft hover:bg-brand-50 hover:text-brand-700">
                {link.label}
              </a>
            </li>
          ))}
          <li className="mt-3 grid grid-cols-2 gap-3 pb-2">
            <a href={account.href} className="btn btn-secondary btn-sm">{account.label}</a>
            <a href={cta.href} className="btn btn-primary btn-sm">{cta.label}</a>
          </li>
        </ul>
      </div>
    </header>
  );
}
