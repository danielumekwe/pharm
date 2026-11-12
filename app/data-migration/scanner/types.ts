import type { Confidence, FieldDef, Fields, Issue, RecordKind } from "@/lib/scanner/fields";

export type { Confidence, FieldDef, Fields, Issue, RecordKind };

export type Candidate = { id: string; name: string; strength: string; dosageForm: string; barcode: string; stock: number; reason: string };
export type ProductDecision = { action: "match"; productId: string } | { action: "create" } | { action: "skip" };

export type ScanRecordView = {
  id: string;
  seq: number;
  number: number;
  kind: RecordKind;
  kindLabel: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "IMPORTED" | "FAILED" | "SKIPPED";
  pageId: string | null;
  page: number | null;
  fields: Fields;
  region: { x: number; y: number; width: number; height: number } | null;
  corrected: boolean;
  manual: boolean;
  decision: { product?: ProductDecision; notDuplicate?: boolean } | null;
  note: string | null;
  result: { outcome: string; reference?: string; importId?: string } | null;
  approvedBy: string | null;
  approvedAt: string | null;
  summary: string;
  issues: Issue[];
  blocked: boolean;
  candidates: Candidate[];
  duplicateOf: string | null;
};

export type ScanPageView = {
  id: string;
  number: number;
  documentId: string;
  documentName: string;
  status: "UPLOADED" | "QUEUED" | "PROCESSING" | "DONE" | "FAILED";
  attempts: number;
  error: string | null;
  width: number | null;
  height: number | null;
  size: number;
  notes: string;
  pageType: string | null;
  readable: boolean | null;
  transcription: string;
  recordCount: number;
  imageUrl: string;
  nextAttemptAt: string | null;
};

export type JobDetail = {
  id: string;
  reference: string;
  title: string;
  category: "inventory" | "sales" | "expenses" | "suppliers";
  categoryLabel: string;
  status: string;
  statusLabel: string;
  outletId: string | null;
  outletName: string;
  stockMode: string | null;
  documents: { id: string; name: string; type: "image" | "pdf"; size: number; pages: number; addedAt: string; addedBy: string; original: boolean }[];
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  message: string | null;
  provider: string | null;
  imports: { inventory?: { importId: string; reference: string; recordIds: string[]; status: string; stagedAt: string; stagedBy: string }[] };
  report: { generatedAt: string; approvedBy: string } | null;
  settings: { provider: string | null; model: string | null; providerConfigured: boolean; providerProblem: string | null; aiApproved: boolean; canChange: boolean };
  permissions: { approve: boolean; importInventory: boolean; financeCreate: boolean; suppliers: boolean };
  pages: ScanPageView[];
  records: ScanRecordView[];
  fields: Partial<Record<RecordKind, FieldDef[]>>;
  expenseCategories: string[];
  needsWorker: boolean;
  reconciliation: {
    documents: number;
    pages: number;
    pagesProcessed: number;
    pagesFailed: number;
    extracted: number;
    validated: number;
    needCorrection: number;
    duplicates: number;
    rejected: number;
    approved: number;
    readyToImport: number;
    imported: number;
    failed: number;
    skipped: number;
    pending: number;
  };
};
