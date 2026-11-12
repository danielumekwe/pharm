import { scannerSettings, setAiApproval } from "@/lib/erp/document-scans";
import { guarded } from "@/lib/session";

/** AI provider status and this pharmacy's approval for sending documents to it. */
export async function GET() {
  return guarded(["documents.scan", "documents.approve", "settings.manage"], (actor) => scannerSettings(actor));
}

/** { aiApproved: boolean } — Super Administrator only. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { aiApproved?: unknown };
  return guarded("settings.manage", (actor) => setAiApproval(actor, body.aiApproved === true));
}
