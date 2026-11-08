"use client";

import { useEffect } from "react";

import { isNativeApp, nativePlugin, shareFile } from "@/lib/native";

/** Files the app should save and share instead of opening (receipts, PDF/Excel exports, documents). */
const FILE_LINK = /\/api\/(sales\/[^/]+\/receipt|sales-overview|inventory-reports|reports\/export|regulatory\/documents\/[^/]+)(\?|$)/;

/**
 * Android app integration, active only inside the Capacitor shell:
 * - hardware back button goes back in the ERP (and closes the app from the dashboard);
 * - receipts and exports are saved and shared, since the WebView cannot open PDFs or downloads itself;
 * - the status bar matches the app's white header.
 */
export function NativeBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;
    document.documentElement.dataset.native = "android";
    void nativePlugin("StatusBar")?.setStyle?.({ style: "LIGHT" }).catch(() => undefined);

    const app = nativePlugin("App");
    let removeBack: (() => void) | undefined;
    void app
      ?.addListener?.("backButton", (data: Record<string, unknown>) => {
        const home = location.pathname === "/dashboard" || location.pathname === "/login" || location.pathname === "/";
        if (data.canGoBack && !home) history.back();
        else void app.exitApp?.();
      })
      .then((handle) => {
        removeBack = () => void (handle as { remove?: () => Promise<void> })?.remove?.();
      })
      .catch(() => undefined);

    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor?.href) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || !FILE_LINK.test(url.pathname + url.search)) return;
      event.preventDefault();
      const name = anchor.getAttribute("download") ?? url.pathname.split("/").filter(Boolean).slice(-2).join("-");
      shareFile(url.toString(), name).catch((error: unknown) => alert(error instanceof Error ? error.message : "Could not open the file."));
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      removeBack?.();
    };
  }, []);
  return null;
}
