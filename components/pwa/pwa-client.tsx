"use client";

import { useEffect, useSyncExternalStore } from "react";

import { getServerState, getState, startPwa, subscribe } from "@/components/pwa/pwa-store";

/** Starts the installable-app runtime once per tab (service worker, install prompt, reachability). */
export function PwaClient() {
  useEffect(() => startPwa(), []);
  return null;
}

export function usePwa() {
  return useSyncExternalStore(subscribe, getState, getServerState);
}
