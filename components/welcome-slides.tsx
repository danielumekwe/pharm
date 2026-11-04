"use client";

import { useEffect, useState } from "react";

const SLIDES = [
  {
    title: "Manage Your Pharmacy Business Efficiently",
    body: "Three outlets, a central warehouse, centralised control, real-time reports and regulatory compliance.",
  },
  {
    title: "Batch-Level Traceability",
    body: "First-expiry-first-out dispensing, automatic quarantine of expired stock and a full controlled-drug register.",
  },
  {
    title: "Approvals You Can Audit",
    body: "Maker-checker stock movements, purchase approvals and expense sign-off — every action logged.",
  },
];

export function WelcomeSlides() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % SLIDES.length), 6000);
    return () => window.clearInterval(timer);
  }, []);

  const slide = SLIDES[index];

  return (
    <div>
      <div className="min-h-[92px] border-l-4 border-lime-400 pl-5" aria-live="polite">
        <p className="text-lg font-semibold text-white md:text-xl">{slide.title}</p>
        <p className="mt-1 max-w-lg text-sm text-emerald-50/85">{slide.body}</p>
      </div>
      <div className="mt-6 flex justify-center gap-2.5 md:pr-24">
        {SLIDES.map((item, i) => (
          <button
            key={item.title}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show slide ${i + 1}`}
            aria-current={i === index}
            className={`h-2.5 w-2.5 rounded-full transition ${i === index ? "bg-lime-400" : "bg-white/40 hover:bg-white/70"}`}
          />
        ))}
      </div>
    </div>
  );
}
