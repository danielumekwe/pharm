"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

export function FaqAccordion({ items }: { items: Array<{ q: string; a: React.ReactNode }> }) {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  return (
    <div className="divide-y divide-brand-100 overflow-hidden rounded-3xl border border-brand-100 bg-white shadow-lp-soft">
      {items.map((item, index) => {
        const isOpen = open === index;
        const headerId = `${base}-h${index}`;
        const panelId = `${base}-p${index}`;
        return (
          <div key={item.q}>
            <h3 className="text-base font-semibold sm:text-[1.0625rem]">
              <button
                type="button"
                id={headerId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : index)}
                className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left transition-colors hover:bg-brand-50/60 sm:px-8"
              >
                {item.q}
                <span className={`grid size-8 shrink-0 place-items-center rounded-full transition-all duration-300 ${isOpen ? "rotate-180 bg-brand-600 text-white" : "bg-brand-50 text-brand-700"}`}>
                  <ChevronDown className="size-4" aria-hidden="true" />
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={headerId}
              inert={!isOpen}
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
              <div className="overflow-hidden">
                <p className="px-6 pb-6 leading-relaxed text-lp-muted sm:px-8">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
