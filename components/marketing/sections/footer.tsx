import { LifeBuoy, Mail, Phone } from "lucide-react";
import Image from "next/image";

import { links, navLinks, site, type Cta } from "@/components/marketing/site";
import logo from "@/public/pharma-erp-logo.png";

type Contact = { email: string | null; phone: string | null };

export function Footer({ cta, signedIn, contact }: { cta: Cta; signedIn: boolean; contact: Contact }) {
  const year = new Date().getFullYear();
  const email = contact.email ?? site.fallbackSupportEmail;
  return (
    <footer className="bg-brand-950 text-brand-100/75">
      <div className="container-x grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <span className="inline-block rounded-2xl bg-white px-4 py-3">
            <Image src={logo} alt="PharmaERP" className="h-9 w-auto" sizes="140px" />
          </span>
          <p className="mt-5 max-w-xs leading-relaxed">
            Pharmacy management software for POS, inventory, batch and expiry tracking, multiple outlets and reports.
          </p>
        </div>

        <nav aria-labelledby="footer-product">
          <h2 id="footer-product" className="text-sm font-bold tracking-[0.12em] !text-white uppercase">Product</h2>
          <ul className="mt-5 space-y-3">
            {[...navLinks, { href: "#about", label: "About" }].map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-colors hover:text-white">{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-account">
          <h2 id="footer-account" className="text-sm font-bold tracking-[0.12em] !text-white uppercase">Get started</h2>
          <ul className="mt-5 space-y-3">
            <li><a href={cta.href} className="transition-colors hover:text-white">{cta.label}</a></li>
            <li>
              {signedIn ? (
                <a href={links.dashboard} className="transition-colors hover:text-white">Dashboard</a>
              ) : (
                <a href={links.login} className="transition-colors hover:text-white">Sign in</a>
              )}
            </li>
            <li><a href={links.contact} className="transition-colors hover:text-white">Contact</a></li>
            <li><a href={links.androidApk} download className="transition-colors hover:text-white">Android app</a></li>
          </ul>
        </nav>

        <div id="contact" className="scroll-mt-24">
          <h2 className="text-sm font-bold tracking-[0.12em] !text-white uppercase">Contact</h2>
          <ul className="mt-5 space-y-4">
            <li>
              <a href={`mailto:${email}`} className="flex items-center gap-3 break-all transition-colors hover:text-white">
                <Mail className="size-4 shrink-0 text-brand-300" aria-hidden="true" /> {email}
              </a>
            </li>
            {contact.phone ? (
              <li>
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-3 transition-colors hover:text-white">
                  <Phone className="size-4 shrink-0 text-brand-300" aria-hidden="true" /> {contact.phone}
                </a>
              </li>
            ) : null}
            <li className="flex items-start gap-3">
              <LifeBuoy className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden="true" />
              Customers can raise support tickets from inside the app.
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-x flex flex-col gap-2 py-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {site.developer}. All rights reserved.</p>
          <p>{`Developed by ${site.developer}.`}</p>
        </div>
      </div>
    </footer>
  );
}
