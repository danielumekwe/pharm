import { jobDetail } from "@/lib/erp/document-scans";
import { guarded } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded(["documents.scan", "documents.approve"], (actor) => jobDetail(actor, id));
}
