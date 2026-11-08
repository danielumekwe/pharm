import { currentTenant } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { openTicket, pharmacyTickets, ticketSchema } from "@/lib/platform/helpdesk";
import { users } from "@/lib/data";
import { guarded } from "@/lib/session";

const tenant = () => {
  const id = currentTenant()?.id;
  if (!id) throw new DomainError("No pharmacy selected.", 401);
  return id;
};
const person = (actor: { id: string; name: string; role: string }) => ({ id: actor.id, name: actor.name, role: actor.role, email: users.find((user) => user.id === actor.id)?.email ?? "" });

/** This pharmacy's support tickets (managers see all; others their own). Works even when the plan has lapsed. */
export async function GET() {
  return guarded("dashboard.view", async (actor) => ({ tickets: await pharmacyTickets(tenant(), person(actor)) }), 200, { allowLapsed: true });
}

export async function POST(request: Request) {
  return guarded("dashboard.view", async (actor) => {
    if (actor.support) throw new DomainError("Web365 support sessions cannot open tickets for the pharmacy.", 403);
    return openTicket(tenant(), person(actor), ticketSchema.parse(await request.json()));
  }, 201, { allowLapsed: true });
}
