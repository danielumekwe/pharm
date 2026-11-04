import { DashboardShell } from "@/components/dashboard-shell";
import { ModulePage } from "@/components/module-page";

export default function PartnersPage() {
  return (
    <DashboardShell>
      <ModulePage
        title="Partners"
        description="Track strategic business partners, reseller relationships, and collaborative sales channels."
        summary={[
          { title: "Active partners", value: "18", note: "8 with quarterly growth", tone: "emerald" },
          { title: "Pipeline", value: "₦5.6M", note: "Qualified opportunities", tone: "sky" },
          { title: "Partner score", value: "92%", note: "Across top channel accounts", tone: "amber" },
          { title: "Renewals", value: "5", note: "Due in the next 30 days", tone: "rose" },
        ]}
        actions={[{ label: "Add partner", tone: "primary" }, { label: "Export report", tone: "secondary" }]}
        rows={[
          { label: "MediLink Distribution", meta: "National wholesaler", value: "Top tier", status: "Approved" },
          { label: "Apex Clinic Group", meta: "Institutional partner", value: "High activity", status: "Healthy" },
          { label: "Lagos Care Network", meta: "Referral channel", value: "Pending review", status: "Pending" },
          { label: "Horizon Medical", meta: "Procurement alliance", value: "Needs renewal", status: "Review" },
        ]}
      />
    </DashboardShell>
  );
}
