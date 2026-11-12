"use client";

import { Download, ScanText } from "lucide-react";
import Link from "next/link";

import { DataTable, type Column } from "@/components/erp/data-table";
import { PageHeader } from "@/components/erp/page-header";
import { StatusBadge } from "@/components/erp/status-badge";

import { JOB_TONES } from "../job-status";

type Job = {
  id: string;
  reference: string;
  title: string;
  categoryLabel: string;
  status: string;
  statusLabel: string;
  outletName: string;
  tenantName: string | null;
  documents: { id: string; name: string; pages: number }[];
  createdAt: string;
  createdBy: string;
  approvedBy: string | null;
  pages: number;
  records: number;
  approved: number;
  imported: number;
};

const OPEN = new Set(["UPLOADED", "PROCESSING", "EXTRACTED", "AWAITING_REVIEW", "PARTIALLY_APPROVED", "APPROVED", "IMPORTING", "FAILED"]);

export function ScanHistory({ jobs, scope }: { jobs: Job[]; scope?: string }) {
  const columns: Column<Job>[] = [
    { key: "reference", header: "Job", render: (row) => <span className="font-medium text-white">{row.reference}</span>, value: (row) => row.reference },
    { key: "title", header: "Name", render: (row) => <span className="text-slate-300">{row.title}</span>, value: (row) => row.title },
    { key: "type", header: "Records", render: (row) => row.categoryLabel, value: (row) => row.categoryLabel },
    { key: "outlet", header: "Outlet", render: (row) => row.outletName, value: (row) => row.outletName },
    { key: "documents", header: "Documents", render: (row) => `${row.documents.length} file(s) · ${row.pages} page(s)`, value: (row) => row.pages },
    { key: "date", header: "Uploaded", render: (row) => new Date(row.createdAt).toLocaleString("en-NG"), value: (row) => row.createdAt },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.statusLabel} tone={JOB_TONES[row.status]} />, value: (row) => row.statusLabel },
    { key: "counts", header: "Extracted / approved / imported", render: (row) => `${row.records} / ${row.approved} / ${row.imported}`, value: (row) => row.records },
    { key: "by", header: "Created by", render: (row) => row.createdBy, value: (row) => row.createdBy },
    { key: "approver", header: "Approved by", render: (row) => row.approvedBy ?? "—", value: (row) => row.approvedBy ?? "" },
    {
      key: "open",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-3">
          <Link href={`/data-migration/scanner/${encodeURIComponent(row.id)}`} className="text-sm text-blue-400 hover:underline">
            {OPEN.has(row.status) ? "Resume" : "Open"}
          </Link>
          <a href={`/api/document-scans/${encodeURIComponent(row.id)}/report`} className="inline-flex items-center gap-1 text-sm text-blue-400 hover:underline" aria-label={`Report for ${row.reference}`}>
            <Download className="h-3.5 w-3.5" /> Report
          </a>
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Data Import Centre"
        title="Scanning Jobs"
        description="Every batch of photographed or scanned paper records, with what was read, approved and imported. Unfinished reviews can be resumed at any time."
        scope={scope}
        actions={
          <Link href="/data-migration" className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-[#fff] hover:bg-blue-700">
            <ScanText className="h-4 w-4" /> New scanning job
          </Link>
        }
      />
      <DataTable rows={jobs} columns={columns} rowKey={(row) => row.id} search={(row) => `${row.reference} ${row.title} ${row.categoryLabel} ${row.createdBy} ${row.documents.map((doc) => doc.name).join(" ")}`} emptyMessage="No scanning jobs yet." />
    </div>
  );
}
