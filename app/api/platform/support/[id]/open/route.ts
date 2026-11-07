import { openSupportSession } from "@/lib/platform/support";
import { platformGuarded } from "@/lib/platform/session";

/** Opens an approved support grant in this browser as a read-only pharmacy session. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("support.request", async (actor) => openSupportSession(actor, id, request));
}
