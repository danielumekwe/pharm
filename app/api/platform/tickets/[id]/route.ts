import { z } from "zod";

import { PRIORITIES, STATUSES, staffReply, staffTicketThread, updateTicket } from "@/lib/platform/helpdesk";
import { platformGuarded } from "@/lib/platform/session";

const status = z.enum(Object.keys(STATUSES) as [keyof typeof STATUSES, ...Array<keyof typeof STATUSES>]);
const priority = z.enum(Object.keys(PRIORITIES) as [keyof typeof PRIORITIES, ...Array<keyof typeof PRIORITIES>]);
const replySchema = z.object({ message: z.string().trim().min(1).max(5000), internal: z.boolean().default(false), status: status.optional() });
const updateSchema = z.object({ status: status.optional(), priority: priority.optional(), assignedTo: z.string().max(80).nullable().optional() });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("support.tickets", async () => staffTicketThread(id));
}

/** A reply to the pharmacy (emailed) or an internal note. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("support.tickets", async (actor) => staffReply(actor, id, replySchema.parse(await request.json())));
}

/** Status, priority and assignment. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return platformGuarded("support.tickets", async (actor) => updateTicket(actor, id, updateSchema.parse(await request.json())));
}
