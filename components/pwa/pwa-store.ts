"use client";

// Shared browser state for the installable app: install prompt availability, installed/standalone mode,
// service worker status and server reachability. One instance per tab; components subscribe to it.

type BeforeInstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type Connection = "online" | "offline" | "restored" | "checking";
export type PwaState = {
  connection: Connection;
  /** When the server last answered a reachability check. */
  lastReachable: string | null;
  canPrompt: boolean;
  standalone: boolean;
  installed: boolean;
  serviceWorker: "unsupported" | "registering" | "active" | "failed" | "disabled";
};

let state: PwaState = { connection: "checking", lastReachable: null, canPrompt: false, standalone: false, installed: false, serviceWorker: "registering" };
const listeners = new Set<() => void>();
let deferred: BeforeInstallPromptEvent | null = null;
let started = false;
let restoredTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let checking: Promise<boolean> | null = null;

const SERVER_STATE: PwaState = { ...state };

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getState = () => state;
export const getServerState = () => SERVER_STATE;

/**
 * True only when the PharmaERP server answers. navigator.onLine alone is not trusted: a device can be on
 * Wi-Fi with no internet.
 */
export function checkConnection(): Promise<boolean> {
  if (checking) return checking;
  checking = (async () => {
    const wasOffline = state.connection === "offline";
    let reachable = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
      clearTimeout(timeout);
      reachable = response.ok;
    } catch {
      reachable = false;
    }
    if (reachable) {
      set({ connection: wasOffline ? "restored" : "online", lastReachable: new Date().toISOString() });
      if (wasOffline) {
        clearTimeout(restoredTimer);
        restoredTimer = setTimeout(() => set({ connection: "online" }), 4000);
        window.dispatchEvent(new CustomEvent("pharmaerp:connection-restored"));
      }
    } else set({ connection: "offline" });
    schedule();
    return reachable;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** Poll more often while offline so reconnection is noticed quickly. */
function schedule() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!document.hidden) void checkConnection();
  }, state.connection === "offline" ? 10_000 : 60_000);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: window-controls-overlay)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const event = deferred;
  deferred = null;
  set({ canPrompt: false });
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") set({ installed: true });
  return outcome;
}

export function startPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  set({ standalone: isStandalone(), installed: isStandalone() });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ installed: true, canPrompt: false });
  });
  window.addEventListener("online", () => void checkConnection());
  window.addEventListener("offline", () => set({ connection: "offline" }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void checkConnection();
  });
  void checkConnection();

  // Service worker: production builds only (in development it would serve stale bundles).
  if (!("serviceWorker" in navigator)) set({ serviceWorker: "unsupported" });
  else if (process.env.NODE_ENV !== "production") set({ serviceWorker: "disabled" });
  else
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then(() => set({ serviceWorker: "active" }))
      .catch(() => set({ serviceWorker: "failed" }));
}
