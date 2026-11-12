import type { Metadata } from "next";

import { OfflineApp } from "./offline-app";

export const metadata: Metadata = { title: "PharmaERP (offline)", robots: { index: false } };

/**
 * The offline app. This page holds no pharmacy data in its HTML: the service worker stores it fetched
 * without cookies, and everything it shows comes from the device's own database after a PIN unlock.
 */
export default function OfflineAppPage() {
  return <OfflineApp />;
}
