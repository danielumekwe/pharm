import { createJob, listJobs } from "@/lib/erp/document-scans";
import { guarded } from "@/lib/session";

/** Scanning jobs of this pharmacy (outlet staff: their outlets' jobs). */
export async function GET() {
  return guarded(["documents.scan", "documents.approve"], (actor) => listJobs(actor));
}

/** New scanning job: { category, title?, outletId?, stockMode?, note? }. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, never>;
  return guarded(["documents.scan", "documents.approve"], (actor) => createJob(actor, body), 201);
}
