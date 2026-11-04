import { DashboardShell } from "@/components/dashboard-shell";
import { ModulePage } from "@/components/module-page";

export default function SmsPage() {
  return (
    <DashboardShell>
      <ModulePage
        title="SMS center"
        description="Manage retail reminders, stock alerts, and customer communication campaigns."
        summary={[
          { title: "Messages sent", value: "4,120", note: "Last 7 days", tone: "emerald" },
          { title: "Delivery rate", value: "96.4%", note: "Strong campaign health", tone: "sky" },
          { title: "Queued", value: "83", note: "Awaiting dispatch", tone: "amber" },
          { title: "Failures", value: "1.8%", note: "Below target", tone: "rose" },
        ]}
        actions={[{ label: "Compose SMS", tone: "primary" }, { label: "View logs", tone: "secondary" }]}
        rows={[
          { label: "Refill appointment reminder", meta: "Pharmacy clients", value: "1,420 sent", status: "Approved" },
          { label: "Low-stock alert", meta: "Store officers", value: "380 queued", status: "Pending" },
          { label: "Collection reminder", meta: "Outstanding invoices", value: "640 sent", status: "Healthy" },
          { label: "Birthday coupon", meta: "Loyalty segment", value: "246 sent", status: "Review" },
        ]}
      />
    </DashboardShell>
  );
}
