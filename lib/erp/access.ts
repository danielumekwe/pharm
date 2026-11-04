// Resolves a user's outlet access and effective permissions from the live user record.
// Every request goes through here, so a stale session or a tampered outlet selector
// can never widen what a user is allowed to see or do.

import { outlets, type User } from "@/lib/data";
import type { Actor } from "@/lib/erp/types";
import { effectivePermissions, isOutletScoped } from "@/lib/rbac";

export const HEAD_OFFICE = "HQ";

export function openOutletIds() {
  return outlets.filter((outlet) => outlet.status !== "CLOSED").map((outlet) => outlet.id);
}

/** Outlets the user may work in. Central roles get every open outlet. */
export function allowedOutletIds(user: Pick<User, "role" | "outletId" | "outletIds">) {
  const open = openOutletIds();
  if (!isOutletScoped(user.role)) return open;
  const assigned = user.outletIds?.length ? user.outletIds : user.outletId ? [user.outletId] : [];
  return assigned.filter((id) => open.includes(id));
}

/**
 * The outlet the user is currently working in.
 * Central roles may choose "all outlets" (null). Outlet roles always work in exactly one allowed outlet.
 */
export function resolveActiveOutlet(user: Pick<User, "role" | "outletId" | "outletIds">, requested: string | null | undefined) {
  const allowed = allowedOutletIds(user);
  if (!isOutletScoped(user.role)) {
    return requested && requested !== HEAD_OFFICE && allowed.includes(requested) ? requested : null;
  }
  if (requested && allowed.includes(requested)) return requested;
  if (user.outletId && allowed.includes(user.outletId)) return user.outletId;
  return allowed[0] ?? null;
}

export function canSwitchTo(user: Pick<User, "role" | "outletId" | "outletIds">, requested: string | null) {
  if (requested === null || requested === HEAD_OFFICE) return !isOutletScoped(user.role);
  return allowedOutletIds(user).includes(requested);
}

export function actorFor(user: User, requestedOutlet: string | null | undefined): Actor | null {
  if ((user.status ?? "ACTIVE") !== "ACTIVE") return null;
  const outletIds = allowedOutletIds(user);
  if (isOutletScoped(user.role) && outletIds.length === 0) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    outletId: resolveActiveOutlet(user, requestedOutlet),
    outletIds,
    permissions: effectivePermissions(user.role, user.grants ?? []),
  };
}
