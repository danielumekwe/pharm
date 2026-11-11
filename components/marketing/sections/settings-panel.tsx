import { BrowserFrame } from "@/components/marketing/device-frames";
import { SectionHeader } from "@/components/marketing/section-header";
import settings from "@/public/landing/screenshots/desktop-settings.jpg";

const bullets = [
  { title: "Your brand on every screen", text: "Your pharmacy's name and logo appear in the browser tab, on the sign-in page and in the sidebar for everyone." },
  { title: "Expiry windows that suit your stock", text: "Choose up to eight near-expiry warning intervals. Alerts, dashboards and reports all use them." },
  { title: "VAT and approval limits", text: "Set the VAT rate charged on sales and the supplier payment amount that needs approval rights." },
];

/** The template's "console showcase" section with numbered bullets. */
export function SettingsPanel() {
  return (
    <section aria-labelledby="settings-title" className="section-y bg-lp-surface">
      <div className="container-x">
        <SectionHeader
          id="settings-title"
          eyebrow="Pharmacy settings"
          title="Configured around how your pharmacy runs"
          text="Owners and super admins control the rules once, and every outlet follows them."
        />
        <div className="grid items-center gap-12 lg:grid-cols-[1.35fr_1fr]">
          <div className="reveal" data-dir="left">
            <BrowserFrame
              src={settings}
              url="pharmerp.name.ng/settings"
              sizes="(min-width: 1024px) 680px, 100vw"
              alt="PharmaERP system settings with branding, super admin user impersonation controls, near-expiry warning intervals and sales and tax settings"
            />
          </div>
          <ol className="reveal space-y-8" data-dir="right">
            {bullets.map((bullet, index) => (
              <li key={bullet.title} className="flex gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-linear-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-lp-brand">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-lg font-bold">{bullet.title}</h3>
                  <p className="mt-1 leading-relaxed text-lp-muted">{bullet.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
