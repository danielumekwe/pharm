import { pageImage } from "@/lib/erp/document-scans";
import { guarded } from "@/lib/session";

/** Page image: needs the signed-in user's access to the job and an unexpired signed link. Never cached. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  const url = new URL(request.url);
  return guarded(["documents.scan", "documents.approve"], async (actor) => {
    const { bytes, mimeType } = await pageImage(actor, id, pageId, { expires: url.searchParams.get("expires"), sig: url.searchParams.get("sig") });
    return new Response(Buffer.from(bytes), {
      headers: { "Content-Type": mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Content-Disposition": "inline" },
    });
  });
}
