import { SectionHeader } from "@/components/marketing/section-header";
import { features } from "@/components/marketing/content";

export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="section-y bg-lp-surface">
      <div className="container-x">
        <SectionHeader
          id="features-title"
          eyebrow="Features"
          title="Everything a modern pharmacy needs to run well"
          text="From the sales counter to the store room and the owner's report, PharmaERP covers the work your team does every day."
        />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text, note }, index) => (
            <li
              key={title}
              className="reveal group relative overflow-hidden rounded-3xl border border-brand-100/80 bg-white p-7 transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lp-soft"
              style={{ transitionDelay: `${(index % 3) * 80}ms` }}
            >
              <span className="mb-5 grid size-12 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-brand-700 transition-colors duration-300 group-hover:border-brand-600 group-hover:bg-brand-600 group-hover:text-white">
                <Icon className="size-[22px]" aria-hidden="true" />
              </span>
              <h3 className="text-lg font-bold">{title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-lp-muted">{text}</p>
              {note ? (
                <p className="mt-4 inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{note}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
