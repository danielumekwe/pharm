// Super Administrator "login as user". Sessions live server-side (database); the browser session
// only carries a session id, which is re-validated on every request.

import { findUserByCredentials, users } from "@/lib/data";
import { DomainError, recordAudit } from "@/lib/erp/services";
import { getStore, nextNumber } from "@/lib/erp/store";
import type { Actor, ImpersonationSession } from "@/lib/erp/types";
import { ROLE_LABELS } from "@/lib/rbac";

function endSession(session: ImpersonationSession, reason: string, by: { id: string; name: string; role: string } = { id: "system", name: "System", role: "SUPER_ADMIN" }) {
  if (session.endedAt) return session;
  session.endedAt = new Date().toISOString();
  session.endReason = reason;
  recordAudit(
    { id: by.id, name: by.name, role: by.role as Actor["role"] },
    {
      action: "impersonation.end",
      entity: "ImpersonationSession",
      entityId: session.id,
      summary: `Impersonation of ${session.targetName} by ${session.adminName} ended — ${reason} (${session.actions} action(s) performed)`,
      severity: "warning",
    },
  );
  return session;
}

/**
 * Returns the session if it may continue, ending it (with the reason) when it may not.
 * Checked on every request, so disabling the feature, suspending either account or timing out takes effect immediately.
 */
export function activeImpersonation(sessionId: string | null | undefined) {
  if (!sessionId) return null;
  const store = getStore();
  const session = store.impersonations.find((row) => row.id === sessionId);
  if (!session || session.endedAt) return null;
  const { impersonation } = store.settings;
  const admin = users.find((user) => user.id === session.adminId);
  const target = users.find((user) => user.id === session.targetId);
  let problem: string | null = null;
  if (!impersonation.enabled && impersonation.onDisable === "terminate") problem = "feature disabled";
  else if (Date.parse(session.expiresAt) <= Date.now()) problem = "time limit reached";
  else if (!admin || admin.role !== "SUPER_ADMIN" || (admin.status ?? "ACTIVE") !== "ACTIVE") problem = "administrator no longer an active Super Administrator";
  else if (!target || (target.status ?? "ACTIVE") !== "ACTIVE") problem = "target account no longer active";
  else if (target.role === "SUPER_ADMIN") problem = "target became a Super Administrator";
  if (problem) {
    endSession(session, problem);
    return null;
  }
  return { session, admin: admin!, target: target! };
}

export async function startImpersonation(admin: Actor, input: { targetUserId: string; password: string; reason: string }) {
  const store = getStore();
  if (admin.impersonation) throw new DomainError("Return to your own account before switching to another user.", 403);
  if (admin.role !== "SUPER_ADMIN") throw new DomainError("Only the Super Administrator can switch user.", 403);
  if (!store.settings.impersonation.enabled) throw new DomainError("User impersonation is disabled in System settings.", 403);

  const adminRecord = users.find((user) => user.id === admin.id);
  // Fresh authentication: the administrator's own password, checked again now.
  const verified = adminRecord ? await findUserByCredentials(adminRecord.email, input.password) : null;
  if (!verified || verified.id !== admin.id) {
    recordAudit(admin, { action: "impersonation.denied", entity: "User", entityId: input.targetUserId, summary: `Switch-user confirmation failed (wrong password) for target ${input.targetUserId}`, severity: "critical" });
    throw new DomainError("Password confirmation failed.", 401);
  }

  const target = users.find((user) => user.id === input.targetUserId);
  if (!target) throw new DomainError("User not found.", 404);
  if (target.id === admin.id) throw new DomainError("You cannot impersonate yourself.");
  if (target.role === "SUPER_ADMIN") throw new DomainError("Super Administrator accounts cannot be impersonated.", 403);
  if ((target.status ?? "ACTIVE") !== "ACTIVE") throw new DomainError(`${target.name}'s account is ${String(target.status).toLowerCase()} and cannot be used.`);
  if (input.reason.trim().length < 5) throw new DomainError("Give a reason for switching user (recorded in the audit trail).");

  // One session per administrator at a time.
  for (const open of store.impersonations.filter((row) => row.adminId === admin.id && !row.endedAt)) endSession(open, "replaced by a new session", admin);

  const now = Date.now();
  const session: ImpersonationSession = {
    id: `imp-${nextNumber("impersonation")}-${now.toString(36)}`,
    adminId: admin.id,
    adminName: admin.name,
    targetId: target.id,
    targetName: target.name,
    targetRole: target.role,
    targetStaffId: target.staffId,
    reason: input.reason.trim(),
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + store.settings.impersonation.maxMinutes * 60_000).toISOString(),
    actions: 0,
  };
  store.impersonations.unshift(session);
  recordAudit(admin, {
    action: "impersonation.start",
    entity: "ImpersonationSession",
    entityId: session.id,
    summary: `${admin.name} started acting as ${target.name} (${target.staffId}, ${ROLE_LABELS[target.role]}) for up to ${store.settings.impersonation.maxMinutes} min — ${session.reason}`,
    outletId: target.outletId,
    severity: "critical",
  });
  return { sessionId: session.id, target: { id: target.id, name: target.name, role: target.role }, expiresAt: session.expiresAt };
}

export function stopImpersonation(actor: Actor) {
  if (!actor.impersonation) throw new DomainError("You are not impersonating anyone.");
  const session = getStore().impersonations.find((row) => row.id === actor.impersonation!.sessionId);
  if (!session) throw new DomainError("Session not found.", 404);
  endSession(session, "returned to Super Administrator", { id: actor.impersonation.adminId, name: actor.impersonation.adminName, role: "SUPER_ADMIN" });
  return { ok: true };
}

/** Ends every running session (used when the feature is switched off with the "terminate" policy). */
export function terminateAllImpersonations(by: Actor, reason: string) {
  const open = getStore().impersonations.filter((row) => !row.endedAt);
  for (const session of open) endSession(session, reason, by);
  return open.length;
}

