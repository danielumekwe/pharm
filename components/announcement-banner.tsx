"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

type Announcement = { id: string; title: string; body: string; severity: string };
const TONE: Record<string, string> = { info: "border-sky-300 bg-sky-50 text-sky-950", warning: "border-amber-300 bg-amber-50 text-amber-950", critical: "border-rose-300 bg-rose-50 text-rose-950" };

/** Announcements from Web365, shown until dismissed. */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  useEffect(() => {
    let active = true;
    fetch("/api/announcements")
      .then(async (response) => (response.ok ? ((await response.json()) as { announcements?: Announcement[] }) : { announcements: [] }))
      .then((data) => {
        if (active) setItems(data.announcements ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  async function dismiss(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    await fetch(`/api/announcements/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  }
  if (!items.length) return null;
  return (
    <div className="mb-4 space-y-2 print:hidden" data-announcement-banner>
      {items.map((item) => (
        <div key={item.id} role={item.severity === "critical" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${TONE[item.severity] ?? TONE.info}`}>
          <div className="min-w-0 flex-1"><p className="font-semibold">{item.title}</p><p className="whitespace-pre-wrap">{item.body}</p></div>
          <button type="button" onClick={() => void dismiss(item.id)} aria-label="Dismiss" className="rounded p-1 hover:bg-black/5"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
