import { DashboardShell } from "@/components/dashboard-shell";
import { users } from "@/lib/data";
import { getStore } from "@/lib/erp/store";
import {
  ALL_PERMISSIONS,
  can,
  CENTRAL_ONLY_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  isOutletScoped,
  LOCKED_PERMISSIONS,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  roleMatrix,
  ROLES,
  SUPER_ADMIN_ONLY,
} from "@/lib/rbac";
import { requirePage } from "@/lib/session";

import { PermissionEditor } from "./permission-editor";

export default async function PermissionsPage() {
  const actor = await requirePage("users.view", "/permissions");
  const matrix = roleMatrix();

  return (
    <DashboardShell>
      <PermissionEditor
        roles={ROLES.map((role) => ({
          value: role,
          label: ROLE_LABELS[role],
          description: ROLE_DESCRIPTIONS[role],
          scoped: isOutletScoped(role),
          activeUsers: users.filter((user) => user.role === role && (user.status ?? "ACTIVE") === "ACTIVE").length,
        }))}
        permissions={ALL_PERMISSIONS.map((key) => {
          const meta = PERMISSIONS[key] as { label: string; group: string; sensitive?: boolean };
          return {
            key,
            label: meta.label,
            group: meta.group,
            sensitive: Boolean(meta.sensitive),
            locked: LOCKED_PERMISSIONS.includes(key),
            centralOnly: CENTRAL_ONLY_PERMISSIONS.includes(key),
            superAdminOnly: SUPER_ADMIN_ONLY.includes(key),
          };
        })}
        matrix={Object.fromEntries(ROLES.map((role) => [role, [...matrix[role]]]))}
        defaults={Object.fromEntries(ROLES.map((role) => [role, [...DEFAULT_ROLE_PERMISSIONS[role]]]))}
        people={users
          .filter((user) => !isOutletScoped(actor.role) || (user.outletIds ?? []).some((id) => actor.outletIds.includes(id)))
          .map((user) => ({ id: user.id, name: user.name, staffId: user.staffId ?? "", role: user.role, grants: user.grants ?? [], status: user.status ?? "ACTIVE" }))}
        history={getStore()
          .audit.filter((event) => event.action.startsWith("permissions.") || (event.action === "users.update" && /granted|revoked|role /.test(event.summary)))
          .slice(0, 30)
          .map((event) => ({ id: event.id, at: event.at, actor: event.actorName, summary: event.summary }))}
        editable={can(actor, "permissions.manage")}
      />
    </DashboardShell>
  );
}
