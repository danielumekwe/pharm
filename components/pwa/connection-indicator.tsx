"use client";

import { CloudOff, RefreshCw, Wifi } from "lucide-react";

import { checkConnection } from "@/components/pwa/pwa-store";
import { usePwa } from "@/components/pwa/pwa-client";

/** Small status pill in the app header. It never interrupts work; clicking re-checks the connection. */
export function ConnectionIndicator() {
  const { connection, lastReachable } = usePwa();
  if (connection === "checking") return null;
  const view = {
    online: { label: "Online", icon: Wifi, tone: "border-emerald-200 bg-emerald-50 text-emerald-700", hide: "hidden lg:inline-flex" },
    restored: { label: "Connection restored", icon: Wifi, tone: "border-emerald-300 bg-emerald-100 text-emerald-800", hide: "inline-flex" },
    offline: { label: "Offline", icon: CloudOff, tone: "border-amber-300 bg-amber-50 text-amber-800", hide: "inline-flex" },
  }[connection];
  const Icon = view.icon;
  const title = connection === "offline" ? `PharmaERP cannot reach the server.${lastReachable ? ` Last connected ${new Date(lastReachable).toLocaleTimeString()}.` : ""} Click to check again.` : "Connected to PharmaERP. Click to check again.";
  return (
    <button
      type="button"
      onClick={() => void checkConnection()}
      title={title}
      aria-live="polite"
      data-connection={connection}
      className={`${view.hide} h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${view.tone}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{view.label}</span>
      {connection === "offline" ? <RefreshCw className="h-3 w-3 opacity-60" aria-hidden="true" /> : null}
    </button>
  );
}
