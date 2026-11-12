import type { Tone } from "@/components/erp/stat-card";

export const JOB_TONES: Record<string, Tone> = {
  UPLOADED: "slate",
  PROCESSING: "sky",
  EXTRACTED: "sky",
  AWAITING_REVIEW: "amber",
  PARTIALLY_APPROVED: "amber",
  APPROVED: "emerald",
  IMPORTING: "sky",
  COMPLETED: "emerald",
  FAILED: "rose",
  CANCELLED: "slate",
};
