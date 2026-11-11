import { SectionHeader } from "@/components/marketing/section-header";
import { benefits } from "@/components/marketing/content";

/** The template's dark statistics band, used for outcomes instead of invented numbers. */
export function Benefits() {
  return (
    <section aria-labelledby="benefits-title" className="section-y relative overflow-hidden bg-linear-to-br from-brand-900 via-brand-950 to-brand-900 text-white">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgb(60_168_66/0.22),transparent_45%),radial-gradient(circle_at_10%_90%,rgb(24_128_48/0.25),transparent_45%)]" />
      <div className="container-x relative">
        <SectionHeader
          dark
          id="benefits-title"
          eyebrow="Benefits"
          title="Less waste, fewer surprises, better decisions"
          text="What changes when your pharmacy runs on one system."
        />
        <ul className="grid gap-px overflow-hidden rounded-3xl bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className="reveal bg-brand-900/70 p-8 transition-colors hover:bg-brand-800/70" style={{ transitionDelay: `${(index % 3) * 80}ms` }}>
              <Icon className="size-7 text-brand-300" aria-hidden="true" />
              <h3 className="mt-5 text-lg font-bold !text-white">{title}</h3>
              <p className="mt-2 leading-relaxed text-brand-100/75">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
