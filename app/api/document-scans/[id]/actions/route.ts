import { approveRecords, cancelJob, importApproved, rejectRecords, reopenRecords } from "@/lib/erp/document-scans";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

/** { action: "approve" (ids | allValid) | "reject" (ids, reason) | "reopen" (ids) | "import" | "cancel" (reason) }. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; ids?: unknown; allValid?: unknown; reason?: unknown };
  return guarded(["documents.scan", "documents.approve"], (actor) => {
    switch (body.action) {
      case "approve":
        return approveRecords(actor, id, body);
      case "reject":
        return rejectRecords(actor, id, body);
      case "reopen":
        return reopenRecords(actor, id, body);
      case "import":
        return importApproved(actor, id);
      case "cancel":
        return cancelJob(actor, id, body.reason);
      default:
        throw new DomainError("Unknown action.");
    }
  });
}
