"use client";

import { AlertTriangle, CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useSyncExternalStore } from "react";

import { usePwa } from "@/components/pwa/pwa-client";
import { checkConnection } from "@/components/pwa/pwa-store";
import { getServerSyncState, getSyncState, subscribeSync } from "@/lib/offline/sync";

/**
 * Small status pill in the app header: connection, uploads waiting or in progress, and anything that needs
 * attention. It never interrupts work; clicking re-checks the connection. When offline it links to the
 * offline till.
 */
export function ConnectionIndicator() {
  const { connection, lastReachable } = usePwa();
  const sync = useSyncExternalStore(subscribeSync, getSyncState, getServerSyncState);
  if (connection === "checking") return null;

  const syncing = sync.phase === "uploading";
  const review = sync.attention + sync.conflicts;
  const view =
    connection === "offline"
      ? { label: sync.pending ? `Offline · ${sync.pending} to upload` : "Offline", icon: CloudOff, tone: "border-amber-300 bg-amber-50 text-amber-800", hide: "inline-flex" }
      : syncing
        ? { label: `Uploading ${sync.done}/${sync.total}`, icon: RefreshCw, tone: "border-sky-200 bg-sky-50 text-sky-800", hide: "inline-flex" }
        : sync.phase === "signin"
          ? { label: `${sync.pending} offline sale(s) waiting`, icon: AlertTriangle, tone: "border-amber-300 bg-amber-50 text-amber-800", hide: "inline-flex" }
          : review
            ? { label: `${review} offline item(s) need review`, icon: AlertTriangle, tone: "border-rose-200 bg-rose-50 text-rose-700", hide: "inline-flex" }
            : sync.pending
              ? { label: `${sync.pending} waiting to upload`, icon: RefreshCw, tone: "border-sky-200 bg-sky-50 text-sky-800", hide: "inline-flex" }
              : connection === "restored"
                ? { label: "Connection restored", icon: Wifi, tone: "border-emerald-300 bg-emerald-100 text-emerald-800", hide: "inline-flex" }
                : { label: sync.lastSyncAt ? "Online · all uploaded" : "Online", icon: Wifi, tone: "border-emerald-200 bg-emerald-50 text-emerald-700", hide: "hidden lg:inline-flex" };
  const Icon = view.icon;
  const title =
    connection === "offline"
      ? `PharmaERP cannot reach the server.${lastReachable ? ` Last connected ${new Date(lastReachable).toLocaleTimeString()}.` : ""} Click to check again.`
      : `${sync.lastSyncAt ? `Last upload ${new Date(sync.lastSyncAt).toLocaleString()}. ` : ""}${sync.message ?? "Connected to PharmaERP."} Click to check again.`;
  return (
    <span className={`${view.hide} items-center gap-1`}>
      <button
        type="button"
        onClick={() => void checkConnection()}
        title={title}
        aria-live="polite"
        data-connection={connection}
        data-sync-phase={sync.phase}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${view.tone}`}
      >
        <Icon className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
        <span>{view.label}</span>
      </button>
      {connection === "offline" ? (
        <a href="/app-offline" className="h-8 rounded-full bg-amber-600 px-2.5 text-xs font-semibold leading-8 text-white">
          Offline till
        </a>
      ) : null}
    </span>
  );
}
