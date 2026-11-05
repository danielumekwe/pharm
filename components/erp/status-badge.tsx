import { toneClass, type Tone } from "@/components/erp/stat-card";

const STATUS_TONES: Record<string, Tone> = {
  // positive
  Paid: "emerald",
  Approved: "emerald",
  Received: "emerald",
  Active: "emerald",
  ACTIVE: "emerald",
  Healthy: "emerald",
  Completed: "emerald",
  info: "sky",
  // in-flight
  Pending: "amber",
  "Pending approval": "amber",
  "Pending verification": "amber",
  Submitted: "amber",
  "Partially paid": "amber",
  "Partially received": "sky",
  Draft: "slate",
  LOW_STOCK: "amber",
  "Near expiry": "amber",
  warning: "amber",
  // negative
  Unpaid: "rose",
  Rejected: "rose",
  Cancelled: "slate",
  Voided: "slate",
  Suspended: "rose",
  SUSPENDED: "rose",
  "On hold": "rose",
  Expired: "rose",
  RESTRICTED: "rose",
  INACTIVE: "slate",
  DISCONTINUED: "rose",
  Quarantined: "rose",
  Depleted: "slate",
  Registered: "emerald",
  critical: "rose",
};

export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  const resolved = tone ?? STATUS_TONES[status] ?? "slate";
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClass(resolved)}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
