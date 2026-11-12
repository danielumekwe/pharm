import { NextResponse } from "next/server";

import { jobDetail } from "@/lib/erp/document-scans";
import { runQueue } from "@/lib/scanner/worker";
import { guarded } from "@/lib/session";

export const maxDuration = 300;

/**
 * Resume reading queued pages (the review screen calls this when pages wait with no worker, e.g. after a
 * retry delay or when the earlier worker stopped). Returns the job when done or out of time.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await runQueue(id, 120_000);
  if (result.stopped) return NextResponse.json({ error: "You cannot process this job." }, { status: result.stopped });
  return guarded(["documents.scan", "documents.approve"], async (actor) => ({ ...(await jobDetail(actor, id)), processed: result.processed }));
}
