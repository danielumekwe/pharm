import { notFound } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { jobDetail, MAX_PAGE_BYTES, MAX_PAGES_PER_JOB, STOCK_MODE_LABELS } from "@/lib/erp/document-scans";
import { DomainError } from "@/lib/erp/services";
import { pageData } from "@/lib/session";

import { JobWorkspace } from "../job-workspace";
import type { JobDetail } from "../types";

export default async function ScanJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return pageData(["documents.scan", "documents.approve"], `/data-migration/scanner/${id}`, async (actor) => {
    let detail: JobDetail;
    try {
      detail = (await jobDetail(actor, id)) as unknown as JobDetail;
    } catch (error) {
      if (error instanceof DomainError && error.status === 404) notFound();
      throw error;
    }
    return (
      <DashboardShell>
        <JobWorkspace initial={detail} stockModes={STOCK_MODE_LABELS} limits={{ maxPageBytes: MAX_PAGE_BYTES, maxPages: MAX_PAGES_PER_JOB }} />
      </DashboardShell>
    );
  });
}
