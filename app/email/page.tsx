import { DashboardShell } from "@/components/dashboard-shell";
import { ModulePage } from "@/components/module-page";

export default function EmailPage() {
  return (
    <DashboardShell>
      <ModulePage
        title="Email center"
        description="Coordinate supplier follow-ups, customer notices, and operational communications."
        summary={[
          { title: "Sent today", value: "326", note: "Across all workflows", tone: "emerald" },
          { title: "Open threads", value: "23", note: "Supplier and client follow-up", tone: "sky" },
          { title: "Bounce rate", value: "0.7%", note: "Healthy list maintenance", tone: "amber" },
          { title: "Campaign CTR", value: "18.9%", note: "Above benchmark", tone: "rose" },
        ]}
        actions={[{ label: "Create email", tone: "primary" }, { label: "Templates", tone: "secondary" }]}
        rows={[
          { label: "Supplier order confirmation", meta: "Procurement", value: "Sent", status: "Approved" },
          { label: "Customer payment reminder", meta: "Finance", value: "Queued", status: "Pending" },
          { label: "Annual stock review", meta: "Operations", value: "Scheduled", status: "Healthy" },
          { label: "Clinical partner update", meta: "Accounts", value: "Awaiting review", status: "Review" },
        ]}
      />
    </DashboardShell>
  );
}
