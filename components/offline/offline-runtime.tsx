"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";

import { deviceFor, downloadPackage, heartbeat, localStatus, offlineSupported, resetPinAttempts } from "@/lib/offline/device";
import { refreshCounts, requestSync } from "@/lib/offline/sync";

const SHELL_KEY = "pharmaerp:shell-refreshed";

/** Downloaded data older than this is refreshed automatically while online. */
const REFRESH_AFTER_MS = 6 * 3_600_000;

/**
 * Keeps a provisioned device current without any button: on start, when the connection returns and when
 * the app comes back to the foreground, it checks in (learning about revocation) and refreshes stale data.
 */
export function OfflineRuntime() {
  const { data } = useSession();
  const user = data?.user as { id?: string; tenantId?: string; support?: unknown } | undefined;
  const tenantId = user?.tenantId;
  const userId = user?.id;

  useEffect(() => {
    if (!tenantId || !userId || user?.support || !offlineSupported()) return;
    let running = false;
    let lastCheckIn = 0;
    /**
     * forced: app start, connection restored, back in the foreground, Background Sync. The one-minute timer
     * only uploads waiting work, and checks in with the server at most every 15 minutes.
     */
    const tick = async (forced: boolean) => {
      if (running || document.hidden) return;
      running = true;
      try {
        const status = await localStatus(tenantId, userId);
        if (!status.provisioned) return;
        const record = await deviceFor(tenantId, userId);
        // Upload offline work first (requestSync checks the server is reachable), then check in.
        if (record && (forced || status.pending > 0)) {
          await requestSync(record);
          await refreshCounts(record);
        }
        if (forced || Date.now() - lastCheckIn > 15 * 60_000) {
          await resetPinAttempts(tenantId, userId);
          await heartbeat(tenantId, userId);
          lastCheckIn = Date.now();
        }
        const age = status.device?.lastPackageAt ? Date.now() - Date.parse(status.device.lastPackageAt) : Infinity;
        if (age > REFRESH_AFTER_MS || status.expired) await downloadPackage(tenantId, userId);
        // Keep the stored offline app in step with deployments (at most every 6 hours).
        try {
          const last = Number(localStorage.getItem(SHELL_KEY) ?? 0);
          if (Date.now() - last > REFRESH_AFTER_MS && navigator.serviceWorker?.controller) {
            navigator.serviceWorker.controller.postMessage("pharmaerp:refresh-shell");
            localStorage.setItem(SHELL_KEY, String(Date.now()));
          }
        } catch {
          // Storage unavailable (private mode): refresh again next time.
        }
      } catch {
        // Offline or temporarily unavailable: the next trigger tries again. Revocation is handled inside.
      } finally {
        running = false;
        window.dispatchEvent(new CustomEvent("pharmaerp:offline-updated"));
      }
    };
    void tick(true);
    const onVisible = () => void tick(true);
    window.addEventListener("pharmaerp:connection-restored", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const onMessage = (event: MessageEvent) => event.data === "pharmaerp:sync" && void tick(true);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const timer = setInterval(() => void tick(false), 60_000);
    return () => {
      window.removeEventListener("pharmaerp:connection-restored", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [tenantId, userId, user?.support]);

  return null;
}
