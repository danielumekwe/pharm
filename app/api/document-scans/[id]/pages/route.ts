import { NextResponse } from "next/server";

import { addPage, MAX_PAGE_BYTES, reorderPages } from "@/lib/erp/document-scans";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

/** One page image: multipart form with `file` (JPEG/PNG) and optional documentId, documentName, documentType (image|pdf). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_PAGE_BYTES + 64 * 1024) return NextResponse.json({ error: "Each page image must be 4 MB or smaller." }, { status: 413 });
  // Received before the database transaction starts, so a slow upload holds no locks.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload the page as a form (multipart/form-data)." }, { status: 400 });
  }
  const file = form.get("file");
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null;
  const text = (key: string) => (typeof form.get(key) === "string" ? String(form.get(key)) : undefined);
  return guarded(
    ["documents.scan", "documents.approve"],
    (actor) => {
      if (!bytes) throw new DomainError("Choose an image to upload.");
      return addPage(actor, id, { bytes, documentId: text("documentId"), documentName: text("documentName") ?? (file instanceof File ? file.name : undefined), documentType: text("documentType"), documentPages: Number(text("documentPages") ?? 0) });
    },
    201,
  );
}

/** New page order: { order: [pageId, …] }. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { order?: unknown };
  return guarded(["documents.scan", "documents.approve"], (actor) => reorderPages(actor, id, body.order));
}
