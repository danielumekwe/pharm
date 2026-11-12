import { removePage, reprocessPage } from "@/lib/erp/document-scans";
import { guarded } from "@/lib/session";

type Params = { params: Promise<{ id: string; pageId: string }> };

/** Remove a page (only while none of its records are approved or imported). */
export async function DELETE(_request: Request, { params }: Params) {
  const { id, pageId } = await params;
  return guarded(["documents.scan", "documents.approve"], (actor) => removePage(actor, id, pageId));
}

/** Read the page again. */
export async function POST(_request: Request, { params }: Params) {
  const { id, pageId } = await params;
  return guarded(["documents.scan", "documents.approve"], (actor) => reprocessPage(actor, id, pageId));
}
