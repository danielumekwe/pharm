import { platformGuarded } from "@/lib/platform/session";
import { DomainError } from "@/lib/erp/services";
import { removeRateLimitEntry } from "@/lib/platform/rate-limits";

/** Remove a tenant/role/endpoint policy override, IP rule, or active temporary IP block. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = new URL(request.url).searchParams.get("kind");
  return platformGuarded("rateLimits.manage", async (actor) => {
    if (kind !== "policy" && kind !== "rule" && kind !== "block") throw new DomainError("Choose a rate-limit entry type.", 400);
    return removeRateLimitEntry(actor, id, kind);
  });
}
