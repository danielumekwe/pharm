import { DashboardShell } from "@/components/dashboard-shell";
import { pageData } from "@/lib/session";

import { InstallWorkspace } from "./install-workspace";

export const metadata = { title: "Install PharmaERP" };

export default async function InstallPage() {
  return pageData("dashboard.view", "/install", () => (
    <DashboardShell>
      <InstallWorkspace />
    </DashboardShell>
  ));
}
