import { DashboardShell } from "@/components/dashboard-shell";
import { listDevices, offlinePolicy } from "@/lib/erp/offline-devices";
import { pageData } from "@/lib/session";

import { DevicesWorkspace } from "./devices-workspace";

export const metadata = { title: "Offline Mode & Devices" };

export default async function DevicesPage() {
  return pageData("settings.manage", "/settings/devices", async (actor) => (
    <DashboardShell>
      <DevicesWorkspace devices={await listDevices(actor)} policy={offlinePolicy()} />
    </DashboardShell>
  ));
}
