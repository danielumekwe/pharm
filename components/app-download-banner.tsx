"use client";

import { Smartphone, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { AndroidIcon } from "@/components/android-icon";

export const ANDROID_APK = "/downloads/PharmaERP.apk";
const KEY = "pharmerp.app-banner-dismissed";

function readDismissed() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

/**
 * Dashboard banner inviting pharmacy staff to install the Android app. Hidden inside the app itself; can be dismissed.
 * Uses literal #fff: the dashboard theme remaps the `white` colour to dark text.
 */
export function AppDownloadBanner() {
  // Server render and first paint assume "dismissed" so the banner never flashes for people who closed it.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  if (dismissed) return null;
  function dismiss() {
    try {
      window.localStorage.setItem(KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    } catch {
      // storage unavailable: nothing to remember
    }
  }
  return (
    <section aria-label="PharmaERP Android app" className="web-only relative flex flex-col gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-[#0a4d29] via-[#0d6a33] to-[#12813c] px-5 py-5 text-[#fff] shadow-lg sm:flex-row sm:items-center sm:px-6" data-app-banner>
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-lime-300/15" />
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#fff]/15 ring-1 ring-[#fff]/25"><Smartphone className="h-6 w-6" aria-hidden="true" /></span>
      <div className="relative min-w-0 flex-1">
        <h2 className="text-lg font-semibold text-[#fff]">Take PharmaERP with you</h2>
        <p className="mt-0.5 text-sm text-emerald-50/90">Sell with barcode scanning, check stock and expiry alerts, and see today&apos;s sales on your Android phone, with the same account.</p>
      </div>
      <div className="relative flex shrink-0 items-center gap-2">
        <a href={ANDROID_APK} download className="inline-flex items-center gap-2 rounded-xl bg-[#fff] px-4 py-2.5 text-sm font-semibold text-[#0a4d29] shadow-sm hover:bg-lime-50">
          <AndroidIcon className="h-5 w-5" /> Download for Android
        </a>
        <button type="button" onClick={dismiss} aria-label="Hide this message" className="rounded-lg p-2 text-[#fff]/80 hover:bg-[#fff]/10 hover:text-[#fff]">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
