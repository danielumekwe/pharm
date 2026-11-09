// Shared by the pharmacy WhatsApp routes: the pharmacy always comes from the signed-in session, never from
// the request, so one pharmacy can never read or change another's recipients or messages.
import { currentTenant } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import type { Actor } from "@/lib/erp/types";

export function sessionTenant() {
  const id = currentTenant()?.id;
  if (!id) throw new DomainError("No pharmacy selected.", 401);
  return id;
}

/** Web365 support sessions are read-only. */
export function assertCanChange(actor: Actor) {
  if (actor.support) throw new DomainError("Web365 support sessions cannot change WhatsApp settings.", 403);
}
