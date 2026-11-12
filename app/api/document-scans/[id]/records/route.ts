import { addManualRecord, updateRecords } from "@/lib/erp/document-scans";
import { guarded } from "@/lib/session";

/** Save corrections: { updates: [{ id, edits?, product?, notDuplicate?, note?, kind? }], bulk?: { ids, field, value } }. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, never>;
  return guarded(["documents.scan", "documents.approve"], (actor) => updateRecords(actor, id, body));
}

/** Type a record in by hand: { kind, pageId?, edits }. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, never>;
  return guarded(["documents.scan", "documents.approve"], (actor) => addManualRecord(actor, id, body), 201);
}
