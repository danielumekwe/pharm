// Support tickets between pharmacies and Web365. A pharmacy sees only its own tickets (always filtered by
// its tenant id), and never Web365's internal notes. Staff replies are emailed to the person who opened the
// ticket; new tickets and pharmacy replies are emailed to Web365's notice address.
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { sendEmail } from "@/lib/notify/email";
import { renderEmail } from "@/lib/notify/templates";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { readPlatformSetting } from "@/lib/platform/settings";
import { appUrl } from "@/lib/saas/account-email";

export const CATEGORIES = { QUESTION: "Question", BUG: "Something is not working", FEATURE: "Feature request", COMPLAINT: "Complaint", BILLING: "Billing" } as const;
export const STATUSES = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING_CUSTOMER: "Waiting for you", RESOLVED: "Resolved", CLOSED: "Closed" } as const;
export const PRIORITIES = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" } as const;
type Category = keyof typeof CATEGORIES;
type Status = keyof typeof STATUSES;
type Priority = keyof typeof PRIORITIES;

export const ticketSchema = z.object({
  category: z.enum(Object.keys(CATEGORIES) as [Category, ...Category[]]),
  subject: z.string().trim().min(5, "Give the ticket a short subject (5+ characters).").max(140),
  message: z.string().trim().min(10, "Describe the issue (10+ characters).").max(5000),
});
export const replySchema = z.object({ message: z.string().trim().min(1).max(5000) });

type TicketRow = {
  id: string; number: number; tenant_id: string; tenant: string; created_by: string; created_by_name: string; created_by_email: string; category: Category; subject: string;
  status: Status; priority: Priority; assigned_to: string | null; assignee: string | null; created_at: Date; updated_at: Date; last_reply_by: string | null; resolved_at: Date | null;
};
const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);
const view = (row: TicketRow) => ({
  id: row.id, number: row.number, tenantId: row.tenant_id, pharmacy: row.tenant, createdBy: row.created_by_name, createdByEmail: row.created_by_email, createdById: row.created_by,
  category: row.category, subject: row.subject, status: row.status, priority: row.priority, assignedTo: row.assigned_to, assignee: row.assignee,
  createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, lastReplyBy: row.last_reply_by, resolvedAt: iso(row.resolved_at),
});
export type TicketView = ReturnType<typeof view>;

const SELECT = `SELECT k.*, t.name AS tenant, p.name AS assignee FROM support_tickets k JOIN tenants t ON t.id = k.tenant_id LEFT JOIN platform_users p ON p.id = k.assigned_to`;

async function notifyWeb365(ticket: TicketView, event: string, message: string) {
  const settings = await readPlatformSetting("email.delivery").catch(() => null);
  const to = settings?.value.notifyEmail;
  if (!to) return;
  const email = await renderEmail("support_new", { number: ticket.number, subject: ticket.subject, pharmacy: ticket.pharmacy, name: ticket.createdBy, event, message, link: `${appUrl()}/platform/support/${ticket.id}` });
  await sendEmail({ to, ...email }, { category: "platform", template: "support_new", tenantId: ticket.tenantId, retryable: true });
}

// ── Pharmacy side ────────────────────────────────────────────────────────────────────────────────────────

type PharmacyUser = { id: string; name: string; email: string; role: string };
/** Super Admins and managers see all of their pharmacy's tickets; others see the ones they opened. */
const seesAll = (user: PharmacyUser) => user.role === "SUPER_ADMIN" || user.role === "PHARMACY_MANAGER";

export async function pharmacyTickets(tenantId: string, user: PharmacyUser) {
  const rows = await platformQuery<TicketRow[]>((query) => query(`${SELECT} WHERE k.tenant_id = $1 AND ($2::boolean OR k.created_by = $3) ORDER BY k.updated_at DESC LIMIT 100`, [tenantId, seesAll(user), user.id]));
  return rows.map(view);
}

async function pharmacyTicket(tenantId: string, user: PharmacyUser, ticketId: string) {
  const [row] = await platformQuery<TicketRow[]>((query) => query(`${SELECT} WHERE k.id = $1 AND k.tenant_id = $2`, [ticketId, tenantId]));
  if (!row || (!seesAll(user) && row.created_by !== user.id)) throw new DomainError("Ticket not found.", 404);
  return view(row);
}

export async function pharmacyTicketThread(tenantId: string, user: PharmacyUser, ticketId: string) {
  const ticket = await pharmacyTicket(tenantId, user, ticketId);
  const messages = await platformQuery<Array<{ id: string; author_type: string; author_name: string; body: string; created_at: Date }>>((query) =>
    query(`SELECT id, author_type, author_name, body, created_at FROM support_messages WHERE ticket_id = $1 AND NOT internal ORDER BY created_at`, [ticketId]),
  );
  return { ticket, messages: messages.map((message) => ({ ...message, created_at: iso(message.created_at)! })) };
}

export async function openTicket(tenantId: string, user: PharmacyUser, input: z.infer<typeof ticketSchema>) {
  const id = `tkt-${randomUUID()}`;
  await platformQuery(async (query) => {
    await query(`INSERT INTO support_tickets (id, tenant_id, created_by, created_by_name, created_by_email, category, subject, priority, last_reply_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pharmacy')`, [id, tenantId, user.id, user.name, user.email, input.category, input.subject, input.category === "BUG" ? "HIGH" : "NORMAL"]);
    await query(`INSERT INTO support_messages (id, ticket_id, author_type, author_id, author_name, body) VALUES ($1, $2, 'pharmacy', $3, $4, $5)`, [`msg-${randomUUID()}`, id, user.id, user.name, input.message]);
  });
  const ticket = await pharmacyTicket(tenantId, user, id);
  await notifyWeb365(ticket, "New ticket", input.message).catch(() => undefined);
  return { ok: true, ticket };
}

export async function pharmacyReply(tenantId: string, user: PharmacyUser, ticketId: string, message: string) {
  const ticket = await pharmacyTicket(tenantId, user, ticketId);
  if (ticket.status === "CLOSED") throw new DomainError("This ticket is closed. Open a new one if you still need help.", 409);
  await platformQuery(async (query) => {
    await query(`INSERT INTO support_messages (id, ticket_id, author_type, author_id, author_name, body) VALUES ($1, $2, 'pharmacy', $3, $4, $5)`, [`msg-${randomUUID()}`, ticketId, user.id, user.name, message]);
    // A reply reopens a resolved ticket and puts it back with Web365.
    await query(`UPDATE support_tickets SET status = CASE WHEN status IN ('WAITING_CUSTOMER', 'RESOLVED') THEN 'OPEN' ELSE status END, resolved_at = NULL, last_reply_by = 'pharmacy', updated_at = now() WHERE id = $1`, [ticketId]);
  });
  await notifyWeb365(ticket, "Pharmacy replied", message).catch(() => undefined);
  return { ok: true };
}

// ── Web365 side ──────────────────────────────────────────────────────────────────────────────────────────

export async function ticketQueue(filters: { status?: string; category?: string; mine?: string; q?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.status === "active") where.push(`k.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER')`);
  else if (filters.status && filters.status in STATUSES) add(`k.status = ?`, filters.status);
  if (filters.category && filters.category in CATEGORIES) add(`k.category = ?`, filters.category);
  if (filters.mine) add(`k.assigned_to = ?`, filters.mine);
  const q = filters.q?.trim();
  if (q) {
    params.push(`%${q.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`, q.replace(/^#/, ""));
    where.push(`(lower(k.subject) LIKE $${params.length - 1} OR lower(t.name) LIKE $${params.length - 1} OR k.number::text = $${params.length})`);
  }
  const rows = await platformQuery<TicketRow[]>((query) =>
    query(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY CASE k.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, k.updated_at DESC LIMIT 200`, params),
  );
  return rows.map(view);
}

export async function ticketCounts() {
  const [row] = await platformQuery<Array<{ open: string; waiting_on_us: string; urgent: string }>>((query) =>
    query(`SELECT count(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER')) AS open, count(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS') AND last_reply_by = 'pharmacy') AS waiting_on_us, count(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS') AND priority = 'URGENT') AS urgent FROM support_tickets`),
  );
  return { open: Number(row?.open ?? 0), waitingOnUs: Number(row?.waiting_on_us ?? 0), urgent: Number(row?.urgent ?? 0) };
}

export async function staffTicketThread(ticketId: string) {
  const [row] = await platformQuery<TicketRow[]>((query) => query(`${SELECT} WHERE k.id = $1`, [ticketId]));
  if (!row) throw new DomainError("Ticket not found.", 404);
  const messages = await platformQuery<Array<{ id: string; author_type: string; author_name: string; body: string; internal: boolean; created_at: Date }>>((query) =>
    query(`SELECT id, author_type, author_name, body, internal, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY created_at`, [ticketId]),
  );
  return { ticket: view(row), messages: messages.map((message) => ({ ...message, created_at: iso(message.created_at)! })) };
}

/** A staff reply (emailed to the pharmacy user) or an internal note (Web365 only). */
export async function staffReply(actor: PlatformActor, ticketId: string, input: { message: string; internal: boolean; status?: Status }) {
  const { ticket } = await staffTicketThread(ticketId);
  const status: Status = input.status ?? (input.internal ? ticket.status : "WAITING_CUSTOMER");
  await platformQuery(async (query) => {
    await query(`INSERT INTO support_messages (id, ticket_id, author_type, author_id, author_name, body, internal) VALUES ($1, $2, 'platform', $3, $4, $5, $6)`, [`msg-${randomUUID()}`, ticketId, actor.id, `${actor.name} (Web365)`, input.message, input.internal]);
    await query(
      `UPDATE support_tickets SET status = $1, resolved_at = CASE WHEN $1 IN ('RESOLVED', 'CLOSED') THEN coalesce(resolved_at, now()) ELSE NULL END,
              last_reply_by = CASE WHEN $2 THEN last_reply_by ELSE 'platform' END, assigned_to = coalesce(assigned_to, $3), updated_at = now() WHERE id = $4`,
      [status, input.internal, actor.id, ticketId],
    );
  });
  if (!input.internal) {
    const email = await renderEmail("support_reply", { name: ticket.createdBy, number: ticket.number, subject: ticket.subject, message: input.message, status: STATUSES[status].toLowerCase(), link: `${appUrl()}/support/${ticket.id}` });
    await sendEmail({ to: ticket.createdByEmail, ...email }, { category: "platform", template: "support_reply", tenantId: ticket.tenantId, retryable: true }).catch(() => undefined);
  }
  await recordPlatformAudit(platformActorRef(actor), { action: input.internal ? "support.ticket-note" : "support.ticket-reply", targetType: "SupportTicket", targetId: ticketId, tenantId: ticket.tenantId, summary: `${input.internal ? "Added an internal note to" : "Replied to"} ticket #${ticket.number} (${ticket.pharmacy})` });
  return { ok: true };
}

export async function updateTicket(actor: PlatformActor, ticketId: string, input: { status?: Status; priority?: Priority; assignedTo?: string | null }) {
  const { ticket } = await staffTicketThread(ticketId);
  if (input.assignedTo) {
    const [staff] = await platformQuery<Array<{ id: string }>>((query) => query(`SELECT id FROM platform_users WHERE id = $1 AND status = 'ACTIVE'`, [input.assignedTo]));
    if (!staff) throw new DomainError("Choose an active staff member.", 400);
  }
  const status = input.status ?? ticket.status;
  const priority = input.priority ?? ticket.priority;
  const assignedTo = input.assignedTo === undefined ? ticket.assignedTo : input.assignedTo;
  await platformQuery((query) =>
    query(`UPDATE support_tickets SET status = $1, priority = $2, assigned_to = $3, resolved_at = CASE WHEN $1 IN ('RESOLVED', 'CLOSED') THEN coalesce(resolved_at, now()) ELSE NULL END, updated_at = now() WHERE id = $4`, [status, priority, assignedTo, ticketId]),
  );
  const changes = [status !== ticket.status ? `status ${ticket.status} → ${status}` : null, priority !== ticket.priority ? `priority ${ticket.priority} → ${priority}` : null, assignedTo !== ticket.assignedTo ? `assigned to ${assignedTo ?? "nobody"}` : null].filter(Boolean);
  if (changes.length) await recordPlatformAudit(platformActorRef(actor), { action: "support.ticket-update", targetType: "SupportTicket", targetId: ticketId, tenantId: ticket.tenantId, summary: `Ticket #${ticket.number}: ${changes.join(", ")}` });
  return { ok: true };
}
