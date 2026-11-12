// Inventory → Offline Sync & Reconciliation. Lists what devices uploaded and settles what could not be
// applied automatically. Original records are never rewritten: a conflict is either retried (applied now
// through the normal rules, attributed to the person who made it offline) or closed with a written reason;
// both are audited. Offline card/transfer payments are confirmed or flagged here.

import { outlets, users } from "@/lib/data";
import { runSql } from "@/lib/db/database";
import { actorFor } from "@/lib/erp/access";
import { evaluate, type OfflineOperation, type OperationOutcome } from "@/lib/erp/offline-sync";
import { assertCan, DomainError, recordAudit } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import { can, isOutletScoped } from "@/lib/rbac";
import { currentTenantId } from "@/lib/saas/tenant";

type Row = {
  id: string;
  device_id: string;
  device_name: string | null;
  user_id: string;
  user_name: string;
  outlet_id: string;
  type: OfflineOperation["type"];
  status: "APPLIED" | "CONFLICT" | "REJECTED" | "RESOLVED";
  local_reference: string | null;
  created_offline_at: Date;
  received_at: Date;
  attempts: number;
  payload: unknown;
  result: OperationOutcome;
  message: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution: string | null;
};

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

function view(row: Row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    localReference: row.local_reference,
    deviceId: row.device_id,
    deviceName: row.device_name ?? row.device_id,
    userName: row.user_name,
    outletId: row.outlet_id,
    outletName: outlets.find((outlet) => outlet.id === row.outlet_id)?.name ?? row.outlet_id,
    createdOfflineAt: iso(row.created_offline_at),
    receivedAt: iso(row.received_at),
    attempts: row.attempts,
    payload: row.payload,
    serverRef: row.result?.serverRef ?? null,
    message: row.message,
    resolvedAt: iso(row.resolved_at),
    resolvedBy: row.resolved_by,
    resolution: row.resolution,
  };
}
export type OfflineOperationView = ReturnType<typeof view>;

function assertReviewer(actor: Actor) {
  if (!can(actor, "stock.approve") && !can(actor, "sales.supervise")) throw new DomainError("Reviewing offline uploads needs stock approval or sales supervision rights.", 403);
}

const scopeClause = (actor: Actor, params: unknown[]) => {
  if (!isOutletScoped(actor.role)) return "";
  params.push(actor.outletIds);
  return ` AND o.outlet_id = ANY($${params.length}::text[])`;
};

export async function listOfflineOperations(actor: Actor) {
  assertReviewer(actor);
  const params: unknown[] = [currentTenantId()];
  const rows = await runSql<Row>(
    `SELECT o.*, d.name AS device_name FROM offline_operations o LEFT JOIN offline_devices d ON d.id = o.device_id AND d.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1${scopeClause(actor, params)} ORDER BY (o.status IN ('CONFLICT', 'REJECTED')) DESC, o.received_at DESC LIMIT 500`,
    params,
  );
  return rows.map(view);
}

/** Offline sales with card/transfer payments nobody has confirmed yet. */
export function unverifiedPayments(actor: Actor) {
  assertReviewer(actor);
  return getStore()
    .sales.filter((sale) => sale.offline?.unverifiedTenders?.length && !sale.offline.verification)
    .filter((sale) => !isOutletScoped(actor.role) || actor.outletIds.includes(sale.outletId))
    .map((sale) => ({ saleId: sale.id, number: sale.number, localNumber: sale.offline!.localNumber, date: sale.date, cashier: sale.cashier, outletName: outlets.find((outlet) => outlet.id === sale.outletId)?.name ?? sale.outletId, deviceName: sale.offline!.deviceName, total: sale.total, tenders: sale.offline!.unverifiedTenders! }));
}

async function loadOperation(actor: Actor, id: string) {
  const params: unknown[] = [currentTenantId(), id];
  const [row] = await runSql<Row>(
    `SELECT o.*, d.name AS device_name FROM offline_operations o LEFT JOIN offline_devices d ON d.id = o.device_id AND d.tenant_id = o.tenant_id WHERE o.tenant_id = $1 AND o.id = $2${scopeClause(actor, params)} FOR UPDATE OF o`,
    params,
  );
  if (!row) throw new DomainError("Offline record not found.", 404);
  if (row.status !== "CONFLICT" && row.status !== "REJECTED") throw new DomainError("Only records that need attention can be retried or closed.", 409);
  return row;
}

/** Applies a kept record now (e.g. after the missing stock was received), as the person who made it. */
export async function retryOperation(actor: Actor, id: string) {
  assertCan(actor, "stock.approve");
  const row = await loadOperation(actor, id);
  const user = users.find((entry) => entry.id === row.user_id);
  const original = user ? actorFor(user, row.outlet_id) : null;
  if (!original) throw new DomainError(`${row.user_name} no longer has an active account here, so the record cannot be applied in their name. Close it with a note instead.`, 409);
  const [device] = await runSql<{ id: string; name: string; outlet_id: string; user_id: string; registered_at: Date }>(`SELECT id, name, outlet_id, user_id, registered_at FROM offline_devices WHERE tenant_id = $1 AND id = $2`, [currentTenantId(), row.device_id]);
  const result = await evaluate({ ...original, tenantId: currentTenantId() }, device, { id: row.id, type: row.type, createdAt: iso(row.created_offline_at)!, payload: row.payload }, iso(row.created_offline_at)!);
  if (result.status !== "APPLIED") throw new DomainError(`Still cannot be applied: ${result.message}`, 409);
  const resolution = `Retried by ${actor.name}: applied${result.serverRef?.number ? ` as ${result.serverRef.number}` : ""}`;
  const outcome: OperationOutcome = { id: row.id, status: "applied", serverRef: result.serverRef, message: resolution };
  await runSql(`UPDATE offline_operations SET status = 'RESOLVED', result = $3::jsonb, resolved_at = now(), resolved_by = $4, resolution = $5 WHERE tenant_id = $1 AND id = $2`, [currentTenantId(), row.id, JSON.stringify(outcome), actor.name, resolution]);
  recordAudit(actor, { action: "offline.resolve", entity: "OfflineOperation", entityId: row.id, summary: `Offline ${row.type} ${row.local_reference ?? ""} from “${row.device_name ?? row.device_id}” (${row.user_name}) — ${resolution}. Original problem: ${row.message}`, outletId: row.outlet_id, severity: "warning" });
  return view({ ...row, status: "RESOLVED", result: outcome, resolved_by: actor.name, resolution, resolved_at: new Date() });
}

/** Settles a record without applying it, e.g. the customer was refunded or the stock was counted again. */
export async function closeOperation(actor: Actor, id: string, note: string) {
  assertCan(actor, "stock.approve");
  const text = note.trim();
  if (text.length < 10) throw new DomainError("Explain how this was settled (at least 10 characters).");
  const row = await loadOperation(actor, id);
  const resolution = `Closed by ${actor.name} without applying: ${text.slice(0, 500)}`;
  await runSql(`UPDATE offline_operations SET status = 'RESOLVED', resolved_at = now(), resolved_by = $3, resolution = $4 WHERE tenant_id = $1 AND id = $2`, [currentTenantId(), row.id, actor.name, resolution]);
  recordAudit(actor, { action: "offline.resolve", entity: "OfflineOperation", entityId: row.id, summary: `Offline ${row.type} ${row.local_reference ?? ""} from “${row.device_name ?? row.device_id}” (${row.user_name}) — ${resolution}. Original problem: ${row.message}`, outletId: row.outlet_id, severity: "critical" });
  return view({ ...row, status: "RESOLVED", resolved_by: actor.name, resolution, resolved_at: new Date() });
}

/** Confirms (or flags as not received) card/transfer money taken offline. The sale itself is not changed. */
export function verifyPayment(actor: Actor, saleId: string, outcome: "verified" | "not-received", note: string) {
  if (!can(actor, "sales.supervise") && !can(actor, "finance.approve")) throw new DomainError("Confirming payments needs sales supervision or finance approval rights.", 403);
  const sale = getStore().sales.find((entry) => entry.id === saleId);
  if (!sale?.offline?.unverifiedTenders?.length || (isOutletScoped(actor.role) && !actor.outletIds.includes(sale.outletId))) throw new DomainError("Offline payment not found.", 404);
  const offline = sale.offline;
  if (offline.verification) throw new DomainError("This payment has already been checked.", 409);
  if (outcome === "not-received" && note.trim().length < 10) throw new DomainError("Explain what happened (at least 10 characters).");
  offline.verification = { outcome, by: actor.name, at: new Date().toISOString(), note: note.trim() || undefined };
  recordAudit(actor, {
    action: "offline.payment",
    entity: "Sale",
    entityId: sale.id,
    summary: `${sale.number} (offline ${offline.localNumber}): ${offline.unverifiedTenders!.map((tender) => `${tender.method} ₦${tender.amount.toLocaleString()}${tender.reference ? ` ref ${tender.reference}` : ""}`).join(", ")} ${outcome === "verified" ? "confirmed as received" : "NOT received — follow up with the cashier/customer"}${note.trim() ? `: ${note.trim()}` : ""}`,
    outletId: sale.outletId,
    severity: outcome === "verified" ? "info" : "critical",
  });
  return { saleId: sale.id, verification: offline.verification };
}
