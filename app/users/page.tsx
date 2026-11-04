import { DashboardShell } from "@/components/dashboard-shell";
import { outlets, users } from "@/lib/data";
import { openOutletIds } from "@/lib/erp/access";
import { outletName } from "@/lib/erp/services";
import { assignableOutlets, assignableRoles, canManageUser, nextStaffId, toStaffRow } from "@/lib/erp/users";
import { getStore } from "@/lib/erp/store";
import { can, isOutletScoped, PERMISSIONS, ROLE_LABELS, ROLES, SUPER_ADMIN_ONLY } from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { UsersWorkspace } from "./users-workspace";

export default async function UsersPage() {
  const actor = await requirePage("users.view", "/users");

  // Outlet roles see the teams of their own outlet(s); central roles see everyone (filtered by the active outlet if chosen).
  const visible = users.filter((user) => {
    const assigned = user.outletIds?.length ? user.outletIds : user.outletId ? [user.outletId] : [];
    if (isOutletScoped(actor.role)) return assigned.some((id) => actor.outletIds.includes(id));
    if (actor.outletId) return assigned.includes(actor.outletId) || !isOutletScoped(user.role);
    return true;
  });

  const grantable = actor.permissions
    .filter((permission) => !SUPER_ADMIN_ONLY.includes(permission) && (permission !== "users.manage" || actor.role === "SUPER_ADMIN"))
    .map((permission) => ({ key: permission, label: PERMISSIONS[permission].label, group: PERMISSIONS[permission].group }));

  const teamOutlets = (isOutletScoped(actor.role) ? actor.outletIds : actor.outletId ? [actor.outletId] : openOutletIds()).map((id) => ({
    id,
    name: outletName(id),
    type: outlets.find((outlet) => outlet.id === id)?.type ?? "RETAIL",
  }));

  return (
    <DashboardShell>
      <UsersWorkspace
        users={visible.map((user) => ({ ...toStaffRow(user), manageable: canManageUser(actor, user) }))}
        teamOutlets={teamOutlets}
        outlets={outlets.map((outlet) => ({ id: outlet.id, name: outlet.name, closed: outlet.status === "CLOSED" }))}
        roles={ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role], scoped: isOutletScoped(role) }))}
        assignableRoles={assignableRoles(actor)}
        assignableOutlets={assignableOutlets(actor)}
        grantable={grantable}
        nextStaffId={nextStaffId()}
        passwordMinLength={getStore().settings.passwordMinLength}
        actorId={actor.id}
        actorIsSuperAdmin={actor.role === "SUPER_ADMIN"}
        scope={actor.outletId ? outletName(actor.outletId) : undefined}
        canManage={can(actor, "users.manage")}
        impersonation={{
          enabled: getStore().settings.impersonation.enabled,
          canStart: actor.role === "SUPER_ADMIN" && !actor.impersonation,
          maxMinutes: getStore().settings.impersonation.maxMinutes,
          sessions: actor.role === "SUPER_ADMIN" ? getStore().impersonations.slice(0, 50) : [],
        }}
      />
    </DashboardShell>
  );
}
