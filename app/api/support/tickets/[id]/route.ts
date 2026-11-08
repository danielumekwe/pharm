import { currentTenant } from "@/lib/db/database";
import { users } from "@/lib/data";
import { DomainError } from "@/lib/erp/services";
import { pharmacyReply, pharmacyTicketThread, replySchema } from "@/lib/platform/helpdesk";
import { guarded } from "@/lib/session";

const tenant = () => {
  const id = currentTenant()?.id;
  if (!id) throw new DomainError("No pharmacy selected.", 401);
  return id;
};
const person = (actor: { id: string; name: string; role: string }) => ({ id: actor.id, name: actor.name, role: actor.role, email: users.find((user) => user.id === actor.id)?.email ?? "" });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("dashboard.view", async (actor) => pharmacyTicketThread(tenant(), person(actor), id), 200, { allowLapsed: true });
}

/** Replies on the ticket (reopens it if it was resolved). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded("dashboard.view", async (actor) => {
    if (actor.support) throw new DomainError("Web365 support sessions cannot reply for the pharmacy.", 403);
    return pharmacyReply(tenant(), person(actor), id, replySchema.parse(await request.json()).message);
  }, 200, { allowLapsed: true });
}
