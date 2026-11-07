// Staff account administration with outlet scoping and a role hierarchy.

import { randomBytes, randomInt } from "node:crypto";

import { outlets, users, type User, type UserStatus } from "@/lib/data";
import { openOutletIds } from "@/lib/erp/access";
import { hashPassword } from "@/lib/password";
import { assertCan, DomainError, outletName, recordAudit } from "@/lib/erp/services";
import { getStore } from "@/lib/erp/store";
import type { Actor } from "@/lib/erp/types";
import {
  CENTRAL_ONLY_PERMISSIONS,
  isOutletScoped,
  isPermission,
  isRole,
  MANAGEABLE_ROLES,
  PERMISSIONS,
  ROLE_LABELS,
  SUPER_ADMIN_ONLY,
  type Permission,
  type Role,
} from "@/lib/rbac";
import { newId } from "@/lib/erp/ids";
import { currentTenant } from "@/lib/db/database";
import { sendJoinPharmacyEmail } from "@/lib/saas/account-email";
import { emailTaken, existingAccount, sharedWithOtherPharmacies } from "@/lib/saas/identity";
import { currentTenantId } from "@/lib/saas/tenant";

const DAY = 1000 * 60 * 60 * 24;
const STAFF_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,19}$/;

// ---------------------------------------------------------------- helpers

export function validatePassword(password: string) {
  const { passwordMinLength } = getStore().settings;
  if (password.length < passwordMinLength) throw new DomainError(`Password must be at least ${passwordMinLength} characters.`);
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new DomainError("Password must include upper-case and lower-case letters and a number.");
  }
}

function temporaryPassword() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  return `Pharm-${randomInt(1000, 9999)}-${letters[randomInt(letters.length)]}${letters[randomInt(letters.length)]}`;
}

async function setPassword(user: User, password: string) {
  user.passwordHash = hashPassword(password);
  user.password = undefined; // seeded plain-text demo password stops working
  user.passwordChangedAt = new Date().toISOString(); // sessions signed in before this stop working
}

export function nextStaffId() {
  const highest = users.reduce((max, user) => Math.max(max, Number(user.staffId?.split("-").pop() ?? 0) || 0), 0);
  return `W365-${String(highest + 1).padStart(4, "0")}`;
}

function assignedOutlets(user: Pick<User, "outletId" | "outletIds">) {
  return user.outletIds?.length ? user.outletIds : user.outletId ? [user.outletId] : [];
}

function newInvite() {
  const { inviteValidityHours } = getStore().settings;
  return { token: randomBytes(24).toString("hex"), expiresAt: new Date(Date.now() + inviteValidityHours * 3_600_000).toISOString(), tenantId: currentTenantId() };
}

/** Public, non-secret view of a user for the admin UI. */
export function toStaffRow(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? "",
    staffId: user.staffId ?? "",
    role: user.role,
    outletId: user.outletId,
    outletIds: assignedOutlets(user),
    status: user.status ?? "ACTIVE",
    grants: (user.grants ?? []).filter(isPermission),
    lastLogin: user.lastLogin ?? null,
    createdAt: user.createdAt ?? null,
    invitePending: Boolean(user.invite && Date.parse(user.invite.expiresAt) > Date.now()),
  };
}
export type StaffRow = ReturnType<typeof toStaffRow>;

// ---------------------------------------------------------------- authorisation

/** Roles this actor may assign. */
export function assignableRoles(actor: Actor): Role[] {
  if (!actor.permissions.includes("users.manage")) return [];
  return MANAGEABLE_ROLES[actor.role];
}

/** Outlets this actor may assign staff to. */
export function assignableOutlets(actor: Actor) {
  return isOutletScoped(actor.role) ? actor.outletIds : openOutletIds();
}

/** Can the actor administer this existing user at all? */
export function canManageUser(actor: Actor, target: User) {
  if (!actor.permissions.includes("users.manage")) return false;
  if (target.id === actor.id) return false;
  if (!MANAGEABLE_ROLES[actor.role].includes(target.role)) return false;
  if (isOutletScoped(actor.role)) {
    // Outlet managers only administer people whose outlets all fall inside their own.
    const outletsOfTarget = assignedOutlets(target);
    return outletsOfTarget.length > 0 && outletsOfTarget.every((id) => actor.outletIds.includes(id));
  }
  return true;
}

function assertManage(actor: Actor, target: User) {
  assertCan(actor, "users.manage");
  if (target.id === actor.id) throw new DomainError("You cannot change your own account here. Ask another administrator.", 403);
  if (!canManageUser(actor, target)) {
    throw new DomainError(`As ${ROLE_LABELS[actor.role]} you cannot manage ${target.name} (${ROLE_LABELS[target.role]}).`, 403);
  }
}

/** Validates a role + outlet assignment the actor wants to give someone. */
function checkAssignment(actor: Actor, role: string, outletIds: string[], primaryOutletId: string | null) {
  if (!isRole(role)) throw new DomainError("Choose a valid role.");
  if (!assignableRoles(actor).includes(role)) throw new DomainError(`You are not allowed to assign the ${ROLE_LABELS[role]} role.`, 403);

  if (!isOutletScoped(role)) return { role, outletIds: [] as string[], primary: null as string | null };

  const unique = Array.from(new Set(outletIds));
  if (unique.length === 0) throw new DomainError(`${ROLE_LABELS[role]} accounts must be assigned to at least one outlet.`);
  const open = openOutletIds();
  for (const id of unique) {
    if (!outlets.some((outlet) => outlet.id === id)) throw new DomainError("Unknown outlet selected.");
    if (!open.includes(id)) throw new DomainError(`${outletName(id)} is closed.`);
    if (!assignableOutlets(actor).includes(id)) throw new DomainError(`You cannot assign staff to ${outletName(id)}.`, 403);
  }
  const primary = primaryOutletId && unique.includes(primaryOutletId) ? primaryOutletId : unique[0];
  return { role, outletIds: unique, primary };
}

/** Individual grants: never more than the actor holds, never central-only to outlet staff, never Super-Admin-only. */
function checkGrants(actor: Actor, role: Role, grants: string[]) {
  const clean = Array.from(new Set(grants));
  for (const grant of clean) {
    if (!isPermission(grant)) throw new DomainError(`Unknown permission "${grant}".`);
    if (SUPER_ADMIN_ONLY.includes(grant)) throw new DomainError(`"${PERMISSIONS[grant].label}" can only be held by the Pharmacy Super Admin role.`);
    if (isOutletScoped(role) && CENTRAL_ONLY_PERMISSIONS.includes(grant)) {
      throw new DomainError(`"${PERMISSIONS[grant].label}" cannot be granted to outlet-level staff.`);
    }
    if (!actor.permissions.includes(grant)) throw new DomainError(`You cannot grant "${PERMISSIONS[grant].label}" because you do not hold it yourself.`, 403);
    if (grant === "users.manage" && actor.role !== "SUPER_ADMIN") throw new DomainError("Only the Pharmacy Super Admin can grant user management.", 403);
  }
  return clean as Permission[];
}

function checkContact(input: { name: string; email: string; phone: string }, excludeId?: string) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  if (name.length < 3) throw new DomainError("Full name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("Enter a valid email address.");
  if (users.some((user) => user.id !== excludeId && user.email.toLowerCase() === email)) throw new DomainError("Another account already uses this email.");
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 14) throw new DomainError("Enter a valid phone number (10–14 digits).");
  return { name, email, phone };
}

// ---------------------------------------------------------------- operations

export type CreateUserInput = {
  name: string;
  email: string;
  phone: string;
  staffId?: string;
  role: string;
  outletIds: string[];
  primaryOutletId: string | null;
  status: "ACTIVE" | "SUSPENDED";
  credential: { mode: "invite" } | { mode: "password"; password: string };
  grants?: string[];
};

export async function createUser(actor: Actor, input: CreateUserInput) {
  assertCan(actor, "users.manage");
  const contact = checkContact(input);
  // Someone who already works for another pharmacy keeps their account; they are invited to join this one.
  const existing = await existingAccount(contact.email);
  const staffId = (input.staffId?.trim() || nextStaffId()).toUpperCase();
  if (!STAFF_ID_PATTERN.test(staffId)) throw new DomainError("Staff ID must be 3–20 letters, numbers or dashes (e.g. W365-0021).");
  if (users.some((user) => user.staffId?.toUpperCase() === staffId)) throw new DomainError(`Staff ID ${staffId} is already in use.`);
  const assignment = checkAssignment(actor, input.role, input.outletIds, input.primaryOutletId);
  const grants = checkGrants(actor, assignment.role, input.grants ?? []);

  if (existing) {
    const member: User = { ...existing, staffId, role: assignment.role, outletId: assignment.primary, outletIds: assignment.outletIds, grants, status: "INVITED" };
    users.push(member);
    const pharmacy = currentTenant()?.name ?? "this pharmacy";
    recordAudit(actor, {
      action: "users.invite-existing",
      entity: "User",
      entityId: member.id,
      summary: `Invited ${member.name} <${member.email}>, who already has an account, to join as ${ROLE_LABELS[member.role]} (${staffId}); waiting for them to accept`,
      outletId: member.outletId,
      severity: "warning",
    });
    await sendJoinPharmacyEmail(member, currentTenantId(), pharmacy, ROLE_LABELS[member.role], actor.name);
    return { user: toStaffRow(member), invitePath: null, temporaryPassword: null, joinPending: true };
  }

  const user: User = {
    id: newId("user", `${Date.now()}`),
    staffId,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    role: assignment.role,
    outletId: assignment.primary,
    outletIds: assignment.outletIds,
    grants,
    createdAt: new Date().toISOString(),
    status: input.credential.mode === "invite" ? "INVITED" : input.status,
    invite: null,
  };

  if (input.credential.mode === "password") {
    validatePassword(input.credential.password);
    await setPassword(user, input.credential.password);
  } else {
    user.invite = newInvite();
  }
  users.push(user);

  recordAudit(actor, {
    action: "users.create",
    entity: "User",
    entityId: user.id,
    summary: `Created ${user.name} (${staffId}) as ${ROLE_LABELS[user.role]} · ${assignment.outletIds.length ? assignment.outletIds.map(outletName).join(", ") : "all outlets"} · ${input.credential.mode === "invite" ? "invitation issued" : "password set by administrator"}${grants.length ? ` · extra: ${grants.join(", ")}` : ""}`,
    outletId: user.outletId,
    severity: "warning",
  });

  return { user: toStaffRow(user), invitePath: user.invite ? `/invite?token=${user.invite.token}` : null, temporaryPassword: null };
}

export type UpdateUserInput = {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  outletIds?: string[];
  primaryOutletId?: string | null;
  grants?: string[];
};

export async function updateUser(actor: Actor, userId: string, input: UpdateUserInput) {
  const user = users.find((row) => row.id === userId);
  if (!user) throw new DomainError("User not found.", 404);
  assertManage(actor, user);

  const changes: string[] = [];
  let severity: "info" | "warning" | "critical" = "info";

  if (input.name !== undefined || input.email !== undefined || input.phone !== undefined) {
    const contact = checkContact({ name: input.name ?? user.name, email: input.email ?? user.email, phone: input.phone ?? user.phone ?? "" }, user.id);
    if (contact.email !== user.email.toLowerCase() && contact.email !== user.email) {
      // An account's email is its sign-in name everywhere; one pharmacy may not change it for another's staff.
      if (await sharedWithOtherPharmacies(user.id, currentTenantId())) throw new DomainError("This person also works for another pharmacy. Only they can change their email.");
      if (await emailTaken(contact.email, user.id)) throw new DomainError("Another account already uses this email.");
    }
    if (contact.name !== user.name) changes.push(`name → ${contact.name}`);
    if (contact.email !== user.email) {
      changes.push(`email → ${contact.email}`);
      if (contact.email.toLowerCase() !== user.email.toLowerCase()) user.emailVerifiedAt = undefined; // the new address is unconfirmed
    }
    if (contact.phone !== (user.phone ?? "")) changes.push("phone updated");
    Object.assign(user, contact);
  }

  if (input.role !== undefined || input.outletIds !== undefined || input.primaryOutletId !== undefined) {
    const assignment = checkAssignment(actor, input.role ?? user.role, input.outletIds ?? assignedOutlets(user), input.primaryOutletId !== undefined ? input.primaryOutletId : user.outletId);
    if (assignment.role !== user.role) {
      changes.push(`role ${ROLE_LABELS[user.role]} → ${ROLE_LABELS[assignment.role]}`);
      severity = "critical";
    }
    const before = assignedOutlets(user).map(outletName).join(", ") || "all outlets";
    const after = assignment.outletIds.map(outletName).join(", ") || "all outlets";
    if (before !== after) {
      changes.push(`outlets ${before} → ${after}`);
      if (severity === "info") severity = "warning";
    }
    if (assignment.primary !== user.outletId && assignment.outletIds.length > 1) changes.push(`primary outlet → ${outletName(assignment.primary)}`);
    user.role = assignment.role;
    user.outletIds = assignment.outletIds;
    user.outletId = assignment.primary;
    // Grants that the new role may not hold are dropped.
    user.grants = (user.grants ?? []).filter((grant) => isPermission(grant) && !(isOutletScoped(user.role) && CENTRAL_ONLY_PERMISSIONS.includes(grant)));
  }

  if (input.grants !== undefined) {
    const before = new Set(user.grants ?? []);
    // Only grants the actor holds may be added or removed by them.
    const next = checkGrants(actor, user.role, input.grants);
    const removed = [...before].filter((grant) => !next.includes(grant as Permission));
    for (const grant of removed) {
      if (isPermission(grant) && !actor.permissions.includes(grant)) throw new DomainError(`You cannot remove "${PERMISSIONS[grant].label}".`, 403);
    }
    const added = next.filter((grant) => !before.has(grant));
    if (added.length) changes.push(`granted ${added.join(", ")}`);
    if (removed.length) changes.push(`revoked ${removed.join(", ")}`);
    if (added.length || removed.length) severity = "critical";
    user.grants = next;
  }

  recordAudit(actor, {
    action: "users.update",
    entity: "User",
    entityId: user.id,
    summary: `${user.name} (${user.staffId}): ${changes.join("; ") || "no changes"}`,
    outletId: user.outletId,
    severity,
  });
  return toStaffRow(user);
}

export function setUserStatus(actor: Actor, userId: string, status: Exclude<UserStatus, "INVITED">, reason: string) {
  const user = users.find((row) => row.id === userId);
  if (!user) throw new DomainError("User not found.", 404);
  assertManage(actor, user);
  const current = user.status ?? "ACTIVE";
  if (current === status) throw new DomainError(`Account is already ${status.toLowerCase()}.`);
  if (status !== "ACTIVE" && reason.trim().length < 3) throw new DomainError("Give a reason for suspending or deactivating the account.");
  if (current === "DEACTIVATED" && status === "ACTIVE" && actor.role !== "SUPER_ADMIN") {
    throw new DomainError("Only the Pharmacy Super Admin can reactivate a deactivated account.", 403);
  }
  if (current === "INVITED" && status === "ACTIVE") throw new DomainError("The user must accept their invitation first, or set a password for them.");

  user.status = status;
  if (status === "DEACTIVATED") user.invite = null;
  recordAudit(actor, {
    action: `users.${status === "ACTIVE" ? "reactivate" : status === "SUSPENDED" ? "suspend" : "deactivate"}`,
    entity: "User",
    entityId: user.id,
    summary: `${user.name} (${user.staffId}) ${current} → ${status}${reason.trim() ? ` — ${reason.trim()}` : ""}`,
    outletId: user.outletId,
    severity: status === "ACTIVE" ? "warning" : "critical",
  });
  return toStaffRow(user);
}

export async function resetPassword(actor: Actor, userId: string) {
  const user = users.find((row) => row.id === userId);
  if (!user) throw new DomainError("User not found.", 404);
  assertManage(actor, user);
  if (user.status === "DEACTIVATED") throw new DomainError("Reactivate the account before resetting its password.");
  // The password protects the person's access to every pharmacy they work for.
  if (await sharedWithOtherPharmacies(user.id, currentTenantId())) throw new DomainError("This person also works for another pharmacy. Only they can change their password.");

  const password = temporaryPassword();
  await setPassword(user, password);
  if (user.status === "INVITED") {
    user.status = "ACTIVE";
    user.invite = null;
  }
  recordAudit(actor, {
    action: "users.reset-password",
    entity: "User",
    entityId: user.id,
    summary: `Password reset for ${user.name} (${user.staffId})`,
    outletId: user.outletId,
    severity: "warning",
  });
  return { user: toStaffRow(user), temporaryPassword: password, invitePath: null };
}

export async function resendInvite(actor: Actor, userId: string) {
  const user = users.find((row) => row.id === userId);
  if (!user) throw new DomainError("User not found.", 404);
  assertManage(actor, user);
  if (user.status !== "INVITED") throw new DomainError("Only users who have not activated their account can be re-invited.");
  if (user.passwordHash || user.password) {
    // An existing account invited to join: send a new join link (their password stays theirs).
    await sendJoinPharmacyEmail(user, currentTenantId(), currentTenant()?.name ?? "this pharmacy", ROLE_LABELS[user.role], actor.name);
    recordAudit(actor, { action: "users.invite-existing", entity: "User", entityId: user.id, summary: `New join link sent to ${user.name} (${user.email})`, outletId: user.outletId });
    return { user: toStaffRow(user), invitePath: null, temporaryPassword: null, joinPending: true };
  }
  user.invite = newInvite();
  recordAudit(actor, { action: "users.invite", entity: "User", entityId: user.id, summary: `New invitation issued to ${user.name} (${user.email})`, outletId: user.outletId });
  return { user: toStaffRow(user), invitePath: `/invite?token=${user.invite.token}`, temporaryPassword: null };
}

// ---------------------------------------------------------------- invitations (public)

export function findInvite(token: string) {
  const user = users.find((row) => row.invite?.token === token);
  if (!user || user.status !== "INVITED" || !user.invite) return null;
  if (Date.parse(user.invite.expiresAt) < Date.now()) return null;
  return user;
}

export async function acceptInvite(token: string, password: string) {
  const user = findInvite(token);
  if (!user) throw new DomainError("This invitation link is invalid or has expired. Ask your manager for a new one.", 410);
  validatePassword(password);
  await setPassword(user, password);
  user.status = "ACTIVE";
  user.invite = null;
  recordAudit(
    { id: user.id, name: user.name, role: user.role },
    { action: "users.activate", entity: "User", entityId: user.id, summary: `${user.name} (${user.staffId}) accepted their invitation and set a password`, outletId: user.outletId },
  );
  return { staffId: user.staffId, email: user.email, outletIds: assignedOutlets(user) };
}

export const INACTIVE_AFTER_DAYS = 30;
export function isDormant(user: Pick<StaffRow, "lastLogin" | "status">) {
  return user.status === "ACTIVE" && (!user.lastLogin || Date.now() - Date.parse(user.lastLogin) > INACTIVE_AFTER_DAYS * DAY);
}
