import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { SectionHeader } from "@/components/marketing/section-header";
import { faqs } from "@/components/marketing/content";


export function Faq({ supportEmail }: { supportEmail: string }) {
  const items = faqs.map((item) =>
    item.q === "How do I get support?"
      ? {
          q: item.q,
          a: (
            <>
              {item.a} Write to{" "}
              <a href={`mailto:${supportEmail}`} className="font-semibold text-brand-700 underline underline-offset-2">
                {supportEmail}
              </a>
              .
            </>
          ),
        }
      : item,
  );
  return (
    <section id="faq" aria-labelledby="faq-title" className="section-y bg-lp-surface">
      <div className="container-x max-w-3xl">
        <SectionHeader id="faq-title" eyebrow="FAQ" title="Frequently asked questions" text="Answers about getting started, outlets, expiry tracking, security and support." />
        <div className="reveal">
          <FaqAccordion items={items} />
        </div>
      </div>
    </section>
  );
}
