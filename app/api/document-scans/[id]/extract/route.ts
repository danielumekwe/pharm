import { after } from "next/server";

import { startExtraction } from "@/lib/erp/document-scans";
import { runQueue } from "@/lib/scanner/worker";
import { guarded } from "@/lib/session";

export const maxDuration = 300;

/** Queue pages for AI reading ({ pageIds? }) and start reading them after the response is sent. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { pageIds?: unknown };
  const response = await guarded(["documents.scan", "documents.approve"], (actor) => startExtraction(actor, id, body));
  if (response.ok) after(() => runQueue(id, 200_000).catch((error) => console.error("[scanner] queue failed", error)));
  return response;
}
