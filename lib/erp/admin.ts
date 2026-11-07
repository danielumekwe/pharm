// Pharmacy Super Admin operations: outlets, role permissions and system settings.

import { outlets, products, stockMovements, users, type Outlet } from "@/lib/data";
import { documentStore } from "@/lib/erp/document-storage";
import { assertCan, DomainError, outletName, recordAudit } from "@/lib/erp/services";
import { DEFAULT_SETTINGS, getStore } from "@/lib/erp/store";
import type { Actor, SystemSettings } from "@/lib/erp/types";
import {
  CENTRAL_ONLY_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  isOutletScoped,
  isPermission,
  isRole,
  LOCKED_PERMISSIONS,
  PERMISSIONS,
  ROLE_LABELS,
  ROLES,
  roleMatrix,
  setRoleMatrix,
  SUPER_ADMIN_ONLY,
  type Permission,
  type Role,
} from "@/lib/rbac";
import { newId } from "@/lib/erp/ids";

// ---------------------------------------------------------------- outlets

export type OutletInput = {
  name: string;
  code: string;
  type: "RETAIL" | "WAREHOUSE";
  address: string;
  manager: string;
  phone: string;
  pcnLicense: string;
  licenceExpiry: string;
};

function checkOutlet(input: OutletInput, excludeId?: string) {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (name.length < 3) throw new DomainError("Outlet name is required.");
  if (!/^[A-Z]{2,4}-\d{2,3}$/.test(code)) throw new DomainError("Code must look like OUT-04 or WH-02.");
  if (outlets.some((outlet) => outlet.id !== excludeId && outlet.code === code)) throw new DomainError(`Code ${code} is already used.`);
  if (outlets.some((outlet) => outlet.id !== excludeId && outlet.name.toLowerCase() === name.toLowerCase())) throw new DomainError("Another outlet has this name.");
  if (input.address.trim().length < 5) throw new DomainError("Address is required.");
  if (input.licenceExpiry && Number.isNaN(Date.parse(input.licenceExpiry))) throw new DomainError("Licence expiry date is invalid.");
  return { ...input, name, code, address: input.address.trim(), manager: input.manager.trim() || "-", phone: input.phone.trim(), pcnLicense: input.pcnLicense.trim() || "Pending" };
}

export function createOutlet(actor: Actor, input: OutletInput) {
  assertCan(actor, "outlets.manage");
  const clean = checkOutlet(input);
  const outlet: Outlet = {
    id: newId("outlet", `${Date.now()}`),
    ...clean,
    stockValue: 0,
    sales: 0,
    status: "ACTIVE",
  };
  outlets.push(outlet);
  recordAudit(actor, { action: "outlets.create", entity: "Outlet", entityId: outlet.id, summary: `Opened ${outlet.name} (${outlet.code}, ${outlet.type === "WAREHOUSE" ? "warehouse" : "retail"})`, outletId: outlet.id, severity: "warning" });
  return outlet;
}

export function updateOutlet(actor: Actor, outletId: string, input: OutletInput & { status: "ACTIVE" | "CLOSED" }) {
  assertCan(actor, "outlets.manage");
  const outlet = outlets.find((row) => row.id === outletId);
  if (!outlet) throw new DomainError("Outlet not found.", 404);
  const clean = checkOutlet(input, outletId);

  if (input.status === "CLOSED" && outlet.status !== "CLOSED") {
    const onHand = products.filter((product) => product.outletId === outletId).reduce((sum, product) => sum + product.stock, 0);
    if (onHand > 0) throw new DomainError(`Transfer out the ${onHand.toLocaleString()} units on hand before closing ${outlet.name}.`);
    if (stockMovements.some((movement) => movement.status === "Pending" && (movement.outletId === outletId || movement.toOutletId === outletId))) {
      throw new DomainError("Resolve pending stock movements for this outlet before closing it.");
    }
  }

  const changes: string[] = [];
  for (const key of ["name", "code", "type", "address", "manager", "phone", "pcnLicense", "licenceExpiry"] as const) {
    if ((outlet[key] ?? "") !== (clean[key] ?? "")) changes.push(`${key} → ${clean[key]}`);
  }
  if ((outlet.status ?? "ACTIVE") !== input.status) changes.push(`status → ${input.status}`);
  Object.assign(outlet, clean, { status: input.status });

  const stranded = input.status === "CLOSED" ? users.filter((user) => isOutletScoped(user.role) && (user.outletIds ?? []).every((id) => id === outletId)).length : 0;
  recordAudit(actor, {
    action: input.status === "CLOSED" ? "outlets.close" : "outlets.update",
    entity: "Outlet",
    entityId: outlet.id,
    summary: `${outlet.name}: ${changes.join(", ") || "no changes"}${stranded ? ` · ${stranded} staff now have no open outlet` : ""}`,
    outletId: outlet.id,
    severity: input.status === "CLOSED" ? "critical" : "info",
  });
  return outlet;
}

// ---------------------------------------------------------------- role permissions

export type PermissionChange = { role: string; permission: string; granted: boolean };

/** Validates every change before applying any of them. */
export function applyPermissionChanges(actor: Actor, changes: PermissionChange[], reason: string) {
  assertCan(actor, "permissions.manage");
  if (changes.length === 0) throw new DomainError("No changes to apply.");
  if (reason.trim().length < 10) throw new DomainError("Explain the reason for this change (at least 10 characters). It is recorded in the audit trail.");

  const matrix = Object.fromEntries(ROLES.map((role) => [role, [...roleMatrix()[role]]])) as Record<Role, Permission[]>;
  for (const change of changes) {
    if (!isRole(change.role)) throw new DomainError(`Unknown role "${change.role}".`);
    if (!isPermission(change.permission)) throw new DomainError(`Unknown permission "${change.permission}".`);
    const role = change.role;
    const permission = change.permission;
    const label = `${PERMISSIONS[permission].label} for ${ROLE_LABELS[role]}`;
    if (role === "SUPER_ADMIN") throw new DomainError("Pharmacy Super Admin permissions cannot be reduced.");
    if (!change.granted && LOCKED_PERMISSIONS.includes(permission)) throw new DomainError(`${label} is required for every role.`);
    if (change.granted && SUPER_ADMIN_ONLY.includes(permission)) throw new DomainError(`${PERMISSIONS[permission].label} is reserved for the Pharmacy Super Admin.`);
    if (change.granted && isOutletScoped(role) && CENTRAL_ONLY_PERMISSIONS.includes(permission)) {
      throw new DomainError(`${label}: outlet-level roles cannot hold central permissions.`);
    }
    const list = matrix[role];
    if (change.granted && !list.includes(permission)) list.push(permission);
    if (!change.granted) matrix[role] = list.filter((item) => item !== permission);
  }

  setRoleMatrix(matrix);
  for (const change of changes) {
    const role = change.role as Role;
    const affected = users.filter((user) => user.role === role && (user.status ?? "ACTIVE") === "ACTIVE").length;
    recordAudit(actor, {
      action: change.granted ? "permissions.grant" : "permissions.revoke",
      entity: "Role",
      entityId: role,
      summary: `${change.granted ? "Granted" : "Revoked"} "${PERMISSIONS[change.permission as Permission].label}" ${change.granted ? "to" : "from"} ${ROLE_LABELS[role]} (${affected} active user${affected === 1 ? "" : "s"}) — ${reason.trim()}`,
      severity: "critical",
    });
  }
  return roleMatrix();
}

export function resetRolePermissions(actor: Actor, role: string, reason: string) {
  assertCan(actor, "permissions.manage");
  if (!isRole(role) || role === "SUPER_ADMIN") throw new DomainError("Choose a role to reset.");
  if (reason.trim().length < 10) throw new DomainError("Explain the reason for this change (at least 10 characters).");
  setRoleMatrix({ ...roleMatrix(), [role]: [...DEFAULT_ROLE_PERMISSIONS[role]] });
  recordAudit(actor, { action: "permissions.reset", entity: "Role", entityId: role, summary: `Reset ${ROLE_LABELS[role]} to default permissions — ${reason.trim()}`, severity: "critical" });
  return roleMatrix();
}

// ---------------------------------------------------------------- system settings

const SETTING_LIMITS: Record<Exclude<keyof SystemSettings, "businessName" | "logoFile" | "expiryIntervals" | "nearExpiryDays" | "impersonation" | "lowStock" | "alertEmail" | "catalog" | "pos" | "salesTargets">, [number, number, string]> = {
  vatRate: [0, 25, "VAT rate"],
  minShelfLifeDays: [30, 730, "Minimum shelf life at receipt"],
  criticalShortagePct: [0, 100, "Critical shortage level"],
  dailySummaryHour: [0, 23, "Daily summary hour"],
  inviteValidityHours: [1, 336, "Invitation validity"],
  supplierPaymentApprovalThreshold: [10_000, 100_000_000, "Supplier payment approval threshold"],
  passwordMinLength: [8, 32, "Minimum password length"],
};

export function updateSettings(actor: Actor, input: Partial<SystemSettings>) {
  assertCan(actor, "settings.manage");
  const settings = getStore().settings;
  const changes: string[] = [];
  if (input.businessName !== undefined) {
    const name = input.businessName.trim();
    if (name.length < 3) throw new DomainError("Business name is required.");
    if (name !== settings.businessName) changes.push(`business name → ${name}`);
    settings.businessName = name;
  }
  if (input.expiryIntervals !== undefined) {
    const intervals = Array.from(new Set(input.expiryIntervals.map((value) => Math.round(Number(value))))).sort((a, b) => b - a);
    if (intervals.length < 1 || intervals.length > 8) throw new DomainError("Configure between 1 and 8 expiry warning intervals.");
    if (intervals.some((value) => !Number.isFinite(value) || value < 7 || value > 730)) throw new DomainError("Expiry intervals must be between 7 and 730 days.");
    const before = settings.expiryIntervals.join("/");
    if (before !== intervals.join("/")) changes.push(`expiry intervals ${before} → ${intervals.join("/")} days`);
    settings.expiryIntervals = intervals;
    settings.nearExpiryDays = intervals[0];
  }
  for (const [key, [min, max, label]] of Object.entries(SETTING_LIMITS) as [keyof typeof SETTING_LIMITS, [number, number, string]][]) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < min || value > max) throw new DomainError(`${label} must be between ${min.toLocaleString()} and ${max.toLocaleString()}.`);
    if (value !== settings[key]) changes.push(`${label} ${settings[key].toLocaleString()} → ${value.toLocaleString()}`);
    settings[key] = value;
  }
  recordAudit(actor, { action: "settings.update", entity: "Settings", entityId: "system", summary: changes.join("; ") || "No changes", severity: changes.length ? "critical" : "info" });
  return settings;
}

export async function resetSettings(actor: Actor) {
  assertCan(actor, "settings.manage");
  // Defaults include the built-in logo, so the uploaded one is removed rather than left orphaned.
  const logoFile = getStore().settings.logoFile;
  if (logoFile) await (await documentStore()).delete(logoFile);
  Object.assign(getStore().settings, structuredClone(DEFAULT_SETTINGS));
  recordAudit(actor, { action: "settings.reset", entity: "Settings", entityId: "system", summary: "System settings reset to defaults", severity: "critical" });
  return getStore().settings;
}

export { outletName };

// ---------------------------------------------------------------- impersonation setting

export async function updateImpersonationSettings(actor: Actor, input: { enabled: boolean; onDisable: "terminate" | "expire"; maxMinutes: number }) {
  assertCan(actor, "settings.manage");
  if (actor.impersonation) throw new DomainError("Return to your own account to change security settings.", 403);
  if (!Number.isInteger(input.maxMinutes) || input.maxMinutes < 5 || input.maxMinutes > 240) throw new DomainError("Maximum session length must be 5–240 minutes.");
  const settings = getStore().settings.impersonation;
  const was = { ...settings };
  Object.assign(settings, input);
  let terminated = 0;
  if (was.enabled && !input.enabled && input.onDisable === "terminate") {
    const { terminateAllImpersonations } = await import("@/lib/erp/impersonation");
    terminated = terminateAllImpersonations(actor, "feature disabled by administrator");
  }
  recordAudit(actor, {
    action: "settings.impersonation",
    entity: "Settings",
    entityId: "impersonation",
    summary: `User impersonation ${input.enabled ? "ENABLED" : "DISABLED"} (on disable: ${input.onDisable}, max ${input.maxMinutes} min)${terminated ? ` — ${terminated} active session(s) terminated` : ""}`,
    severity: "critical",
  });
  return { ...settings, terminated };
}

// ---------------------------------------------------------------- POS rules and sales targets

export function updatePosSettings(actor: Actor, input: { cashierMaxDiscountPct: number; approverMaxDiscountPct: number; salesTargets: Record<string, number> }) {
  assertCan(actor, "settings.manage");
  const settings = getStore().settings;
  if (!(input.cashierMaxDiscountPct >= 0 && input.cashierMaxDiscountPct <= 100)) throw new DomainError("Cashier discount limit must be 0–100%.");
  if (!(input.approverMaxDiscountPct >= input.cashierMaxDiscountPct && input.approverMaxDiscountPct <= 100)) throw new DomainError("The supervisor limit must be between the cashier limit and 100%.");
  const targets: Record<string, number> = {};
  for (const [outletId, value] of Object.entries(input.salesTargets)) {
    if (!outlets.some((outlet) => outlet.id === outletId)) throw new DomainError("Unknown outlet in sales targets.");
    if (!Number.isFinite(value) || value < 0) throw new DomainError("Sales targets must be zero or more.");
    if (value > 0) targets[outletId] = Math.round(value);
  }
  const before = `${settings.pos.cashierMaxDiscountPct}%/${settings.pos.approverMaxDiscountPct}%`;
  settings.pos = { cashierMaxDiscountPct: input.cashierMaxDiscountPct, approverMaxDiscountPct: input.approverMaxDiscountPct };
  settings.salesTargets = targets;
  recordAudit(actor, {
    action: "settings.pos",
    entity: "Settings",
    entityId: "pos",
    summary: `POS discount limits ${before} → ${input.cashierMaxDiscountPct}%/${input.approverMaxDiscountPct}%; daily targets ${Object.entries(targets).map(([id, value]) => `${outletName(id)} ₦${value.toLocaleString()}`).join(", ") || "none"}`,
    severity: "warning",
  });
  return { pos: settings.pos, salesTargets: settings.salesTargets };
}
