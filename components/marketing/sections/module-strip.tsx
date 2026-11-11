import { modules } from "@/components/marketing/content";

/** Replaces the template's "trusted companies" logo strip with the app's real module names. */
export function ModuleStrip() {
  const row = [...modules, ...modules];
  return (
    <section aria-labelledby="modules-title" className="border-y border-brand-100/70 bg-white py-10">
      <div className="container-x">
        <h2 id="modules-title" className="mb-6 text-center text-xs font-semibold tracking-[0.18em] text-lp-muted uppercase">
          Every part of your pharmacy, in one platform
        </h2>
      </div>
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <ul className="flex w-max gap-3 animate-lp-marquee hover:[animation-play-state:paused]">
          {row.map((name, index) => (
            <li
              key={`${name}-${index}`}
              aria-hidden={index >= modules.length ? "true" : undefined}
              className="rounded-full border border-brand-100 bg-brand-50/60 px-5 py-2 text-sm font-semibold whitespace-nowrap text-brand-800"
            >
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
