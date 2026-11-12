import { NextResponse } from "next/server";

import { addOriginal, MAX_ORIGINAL_BYTES, originalDocument } from "@/lib/erp/document-scans";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

/** Keep an uploaded PDF as it was: multipart form with `file`, `documentId`, `documentName`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_ORIGINAL_BYTES + 64 * 1024) return NextResponse.json({ error: "Original PDFs up to 4 MB are kept; larger files keep their page images only." }, { status: 413 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload the document as a form (multipart/form-data)." }, { status: 400 });
  }
  const file = form.get("file");
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null;
  return guarded(
    ["documents.scan", "documents.approve"],
    (actor) => {
      if (!bytes) throw new DomainError("Choose a PDF to upload.");
      return addOriginal(actor, id, { bytes, documentId: String(form.get("documentId") ?? ""), documentName: String(form.get("documentName") ?? (file instanceof File ? file.name : "")) });
    },
    201,
  );
}

/** Download a stored original: ?document=<id>. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const documentId = new URL(request.url).searchParams.get("document") ?? "";
  return guarded(["documents.scan", "documents.approve"], async (actor) => {
    const file = await originalDocument(actor, id, documentId);
    const name = file.name.replace(/[^\w.\- ]+/g, "_");
    return new Response(Buffer.from(file.bytes), {
      headers: { "Content-Type": file.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="${name}"` },
    });
  });
}
