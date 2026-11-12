// Reads queued pages of a scanning job, one at a time. Each page is claimed and stored in its own short
// database transaction; the AI provider is called between them, so no transaction or lock is held while a
// page is being read. Safe to run several times at once: a page is leased to one worker.

import { claimNextPage, completePage, type ClaimedPage } from "@/lib/erp/document-scans";
import { documentReader, ProviderError } from "@/lib/scanner/providers";
import { guarded } from "@/lib/session";
import type { Permission } from "@/lib/rbac";

const PERMISSIONS: Permission[] = ["documents.scan", "documents.approve"];

/** Stops taking new pages after `budgetMs` (a page already started is finished). */
export async function runQueue(jobId: string, budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  while (Date.now() < deadline) {
    const holder: { claim: ClaimedPage | null } = { claim: null };
    const claimed = await guarded(PERMISSIONS, async (actor) => {
      holder.claim = await claimNextPage(actor, jobId);
      return { ok: true };
    });
    if (claimed.status >= 400) return { processed, stopped: claimed.status };
    const claim = holder.claim;
    if (!claim) break;
    let outcome: Parameters<typeof completePage>[2];
    const started = Date.now();
    let reader: { id: string; model: string } | null = null;
    try {
      const instance = documentReader();
      reader = instance;
      const extraction = await instance.readPage({ image: claim.image, mimeType: claim.mimeType, category: claim.category, guidance: claim.guidance, pageNumber: claim.pageNumber, pageCount: claim.pageCount });
      outcome = { extraction, durationMs: Date.now() - started };
    } catch (error) {
      const meta = { durationMs: Date.now() - started, provider: reader?.id, model: reader?.model };
      if (error instanceof ProviderError) outcome = { error: error.message, retryable: error.retryable, ...meta };
      else {
        console.error("[scanner] page reading failed", error);
        outcome = { error: "Reading the page failed unexpectedly. It will be tried again.", retryable: true, ...meta };
      }
    }
    await guarded(PERMISSIONS, (actor) => completePage(actor, claim, outcome));
    processed += 1;
  }
  return { processed };
}
