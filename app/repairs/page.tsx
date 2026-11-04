import { DashboardShell } from "@/components/dashboard-shell";
import { ModulePage } from "@/components/module-page";

export default function RepairsPage() {
  return (
    <DashboardShell>
      <ModulePage
        title="Repairs"
        description="Monitor equipment servicing, repair jobs, vendor turnaround, and service completion."
        summary={[
          { title: "Open jobs", value: "14", note: "4 urgent repairs", tone: "amber" },
          { title: "Completed", value: "31", note: "This month", tone: "emerald" },
          { title: "Avg. SLA", value: "2.4d", note: "Service turnaround", tone: "sky" },
          { title: "Cost value", value: "₦1.2M", note: "Across active jobs", tone: "rose" },
        ]}
        actions={[{ label: "New repair", tone: "primary" }, { label: "Export report", tone: "secondary" }]}
        rows={[
          { label: "Generator service", meta: "Lekki outlet", value: "Awaiting parts", status: "Pending" },
          { label: "Refrigeration unit", meta: "Victoria Island", value: "Fixed", status: "Approved" },
          { label: "POS terminal", meta: "Ikeja branch", value: "Under testing", status: "Review" },
          { label: "Air conditioner", meta: "Warehouse", value: "Scheduled", status: "Healthy" },
        ]}
      />
    </DashboardShell>
  );
}
