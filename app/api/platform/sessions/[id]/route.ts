import { platformCan, platformGuarded } from "@/lib/platform/session";
import { revokeSession } from "@/lib/platform/security";

/** Ends a session: one's own, or anyone's for Platform Super Admins. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("self", async (actor) => revokeSession(actor, id, platformCan(actor, "staff.manage") && !actor.pending));
}
