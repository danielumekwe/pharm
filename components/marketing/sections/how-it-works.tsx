import { SectionHeader } from "@/components/marketing/section-header";
import { steps } from "@/components/marketing/content";
import type { Cta } from "@/components/marketing/site";

export function HowItWorks({ cta }: { cta: Cta }) {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="section-y bg-white">
      <div className="container-x">
        <SectionHeader
          id="how-title"
          eyebrow="How it works"
          title="Up and running in four steps"
          text="No installation and no hardware to buy. Your team can start from any browser."
        />
        <div className="relative">
        <div aria-hidden="true" className="absolute top-7 right-[12%] left-[12%] hidden h-px bg-linear-to-r from-brand-100 via-brand-300 to-brand-100 lg:block" />
        <ol className="relative grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="reveal relative rounded-3xl border border-brand-100/80 bg-white p-7 text-center lg:border-0 lg:bg-transparent lg:p-2" style={{ transitionDelay: `${index * 90}ms` }}>
              <span className="relative mx-auto grid size-14 place-items-center rounded-full border-4 border-white bg-linear-to-br from-brand-500 to-brand-700 font-lp-heading text-lg font-extrabold text-white shadow-lp-brand">
                {index + 1}
              </span>
              <h3 className="mt-5 text-lg font-bold">{step.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-lp-muted">{step.text}</p>
            </li>
          ))}
        </ol>
        </div>
        <div className="reveal mt-12 text-center">
          <a href={cta.href} className="btn btn-primary">{cta.label}</a>
        </div>
      </div>
    </section>
  );
}
