// Role-based access control. Pure module: safe to import from client, server, and proxy code.
// Server code checks permissions against the live matrix (editable by the Super Administrator);
// client code should rely on the permission list delivered in the session.

export type Role =
  | "SUPER_ADMIN"
  | "PHARMACY_MANAGER"
  | "REGULATORY_OFFICER"
  | "SALES_MANAGER"
  | "STOCK_MANAGER"
  | "CASHIER"
  | "STAFF";

export const ROLES: Role[] = ["SUPER_ADMIN", "PHARMACY_MANAGER", "REGULATORY_OFFICER", "SALES_MANAGER", "STOCK_MANAGER", "CASHIER", "STAFF"];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Pharmacy Super Admin",
  PHARMACY_MANAGER: "Pharmacy Manager",
  REGULATORY_OFFICER: "Regulatory Affairs Officer",
  SALES_MANAGER: "Sales Manager",
  STOCK_MANAGER: "Inventory / Stock Manager",
  CASHIER: "Cashier",
  STAFF: "General Staff",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN: "Full control of this pharmacy: outlets, users, roles, permissions and settings. No access to other pharmacies or to the Web365 platform.",
  PHARMACY_MANAGER: "All outlets. Manages outlet managers and staff, consolidated reports and approvals.",
  REGULATORY_OFFICER: "All outlets. Product registrations, licences, regulatory documents and compliance.",
  SALES_MANAGER: "Assigned outlet. Sales, returns and cancellations, cashier supervision and sales reports.",
  STOCK_MANAGER: "Assigned outlet. Receiving, issues, batches, expiry, transfers and inventory reports.",
  CASHIER: "Assigned outlet. Point of sale, own sales history and permitted customer and payment functions.",
  STAFF: "Assigned outlet. Day-to-day authorised tasks such as dispensing and point of sale.",
};

/** Central roles see every outlet; the others are limited to their assigned outlet(s). */
export const NETWORK_ROLES: Role[] = ["SUPER_ADMIN", "PHARMACY_MANAGER", "REGULATORY_OFFICER"];
export const OUTLET_SCOPED_ROLES: Role[] = ["SALES_MANAGER", "STOCK_MANAGER", "CASHIER", "STAFF"];

type PermissionMeta = { label: string; group: string; sensitive?: boolean };

export const PERMISSIONS = {
  "dashboard.view": { label: "View dashboard", group: "General" },
  "sales.view": { label: "View sales", group: "Sales" },
  "sales.create": { label: "Make sales (POS)", group: "Sales" },
  "sales.void": { label: "Approve returns & cancel sales", group: "Sales" },
  "sales.supervise": { label: "View all outlet sales & supervise cashiers", group: "Sales" },
  "sales.discount": { label: "Authorise discounts above the cashier limit", group: "Sales" },
  "purchase.view": { label: "View purchase orders", group: "Purchasing" },
  "purchase.create": { label: "Raise purchase orders", group: "Purchasing" },
  "purchase.approve": { label: "Approve purchase orders", group: "Purchasing" },
  "purchase.receive": { label: "Receive goods (GRN)", group: "Purchasing" },
  "contacts.view": { label: "View customers & suppliers", group: "Contacts" },
  "contacts.manage": { label: "Manage customers & suppliers", group: "Contacts" },
  "products.view": { label: "View item information", group: "Inventory" },
  "products.manage": { label: "Register & maintain items", group: "Inventory" },
  "products.price": { label: "Change purchase & selling prices", group: "Inventory", sensitive: true },
  "catalog.manage": { label: "Configure product catalogue (categories, dosage forms, packaging types)", group: "Inventory" },
  "stock.view": { label: "View stock & movements", group: "Inventory" },
  "stock.levels": { label: "See stock levels (quantity left, read-only)", group: "Sales" },
  "stock.request": { label: "Issue stock, transfers & adjustments", group: "Inventory" },
  "stock.approve": { label: "Approve stock movements", group: "Inventory" },
  "inventory.import": { label: "Bulk import products & opening stock (and roll imports back)", group: "Inventory", sensitive: true },
  "documents.scan": { label: "Scan & proofread paper records (AI Document Scanner)", group: "Inventory" },
  "documents.approve": { label: "Approve & import scanned paper records", group: "Inventory", sensitive: true },
  "ai.wallet.view": { label: "View the AI Wallet & coin transactions", group: "AI Wallet" },
  "ai.usage.view": { label: "View AI usage by staff and job", group: "AI Wallet" },
  "ai.coins.purchase": { label: "Buy AI coins (Paystack)", group: "AI Wallet", sensitive: true },
  "ai.wallet.manage": { label: "Manage the AI Wallet", group: "AI Wallet", sensitive: true },
  "alerts.view": { label: "View inventory alerts", group: "Inventory" },
  "alerts.manage": { label: "Manage alerts, thresholds & expired stock", group: "Inventory" },
  "alerts.configure": { label: "Configure threshold rules & alert emails", group: "Inventory", sensitive: true },
  "finance.view": { label: "View expenses & payments", group: "Finance" },
  "finance.create": { label: "Record expenses & payments", group: "Finance" },
  "finance.approve": { label: "Approve & pay expenses", group: "Finance", sensitive: true },
  "reports.sales": { label: "Sales reports", group: "Reports" },
  "reports.inventory": { label: "Inventory reports", group: "Reports" },
  "reports.financial": { label: "Financial reports (P&L, VAT)", group: "Reports" },
  "reports.consolidated": { label: "Consolidated multi-outlet reports", group: "Reports" },
  "regulatory.view": { label: "View regulatory register", group: "Regulatory" },
  "regulatory.manage": { label: "Manage registrations, licences & documents", group: "Regulatory" },
  "audit.view": { label: "View audit trail & compliance", group: "Regulatory" },
  "outlets.view": { label: "View outlets & warehouses", group: "Administration" },
  "outlets.manage": { label: "Create & manage outlets", group: "Administration", sensitive: true },
  "users.view": { label: "View staff", group: "Administration" },
  "users.manage": { label: "Manage staff accounts", group: "Administration", sensitive: true },
  "permissions.manage": { label: "Configure role permissions", group: "Administration", sensitive: true },
  "settings.manage": { label: "Configure system settings", group: "Administration", sensitive: true },
  "addons.view": { label: "Use add-on modules", group: "General" },
} as const satisfies Record<string, PermissionMeta>;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Every role keeps these; removing them would lock users out of the app shell. */
export const LOCKED_PERMISSIONS: Permission[] = ["dashboard.view"];

/** Never grantable to outlet-level roles or individual outlet staff. */
export const CENTRAL_ONLY_PERMISSIONS: Permission[] = ["outlets.manage", "permissions.manage", "settings.manage", "reports.consolidated", "alerts.configure", "catalog.manage"];

/** Only the Super Administrator may hold these. */
export const SUPER_ADMIN_ONLY: Permission[] = ["permissions.manage", "settings.manage", "outlets.manage", "ai.wallet.manage"];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  // Operational control across outlets; selling at the till and alert/email rules stay with cashiers and the Super Admin.
  PHARMACY_MANAGER: ALL_PERMISSIONS.filter((permission) => !SUPER_ADMIN_ONLY.includes(permission) && !["regulatory.manage", "sales.create", "alerts.configure", "inventory.import", "documents.approve", "ai.coins.purchase"].includes(permission)),
  REGULATORY_OFFICER: [
    "dashboard.view",
    "products.view",
    "stock.view",
    "alerts.view",
    "alerts.manage",
    "purchase.view",
    "contacts.view",
    "outlets.view",
    "reports.inventory",
    "reports.consolidated",
    "regulatory.view",
    "regulatory.manage",
    "audit.view",
  ],
  // Sales only: the till, sales history, returns, customers and sales reports. Stock is visible as quantities left, read-only.
  SALES_MANAGER: [
    "dashboard.view",
    "sales.view",
    "sales.create",
    "sales.void",
    "sales.supervise",
    "sales.discount",
    "contacts.view",
    "contacts.manage",
    "stock.levels",
    "reports.sales",
  ],
  STOCK_MANAGER: [
    "dashboard.view",
    "products.view",
    "products.manage",
    "stock.view",
    "stock.request",
    "stock.approve",
    "inventory.import",
    "documents.scan",
    "ai.wallet.view",
    "alerts.view",
    "alerts.manage",
    "purchase.view",
    "purchase.create",
    "purchase.receive",
    "contacts.view",
    "reports.inventory",
    "outlets.view",
  ],
  CASHIER: ["dashboard.view", "sales.view", "sales.create", "contacts.view", "stock.levels"],
  STAFF: ["dashboard.view", "sales.view", "contacts.view", "products.view", "stock.view", "alerts.view"],
};

/** Which roles a user may assign or administer. Outlet managers only supervise Staff in their own outlet. */
export const MANAGEABLE_ROLES: Record<Role, Role[]> = {
  SUPER_ADMIN: ROLES,
  PHARMACY_MANAGER: ["SALES_MANAGER", "STOCK_MANAGER", "CASHIER", "STAFF"],
  REGULATORY_OFFICER: [],
  SALES_MANAGER: ["CASHIER", "STAFF"],
  STOCK_MANAGER: [],
  CASHIER: [],
  STAFF: [],
};

// ---------------------------------------------------------------- live matrix (server)

const MATRIX_KEY = "__pharm_rolePermissions_v5";
type Registry = typeof globalThis & Record<string, Record<Role, Permission[]> | undefined>;

/** Current role → permissions matrix. On the server it reflects Super Admin edits. */
export function roleMatrix(): Record<Role, Permission[]> {
  const live = (globalThis as Registry)[MATRIX_KEY];
  if (!live) return DEFAULT_ROLE_PERMISSIONS;
  // Permissions introduced after a matrix was saved start with their default roles (until an administrator edits them).
  const known = new Set(Object.values(live).flat());
  const introduced = ADDED_PERMISSIONS.filter((permission) => !known.has(permission));
  // Fall back to defaults for any role missing from a stored matrix.
  return Object.fromEntries(
    ROLES.map((role) => {
      const permissions = live[role] ?? DEFAULT_ROLE_PERMISSIONS[role];
      const extra = introduced.filter((permission) => DEFAULT_ROLE_PERMISSIONS[role].includes(permission));
      return [role, extra.length ? [...permissions, ...extra] : permissions];
    }),
  ) as Record<Role, Permission[]>;
}

/** Permissions added after the first release; stored matrices without them get the defaults. */
const ADDED_PERMISSIONS: Permission[] = ["catalog.manage", "sales.supervise", "sales.discount", "products.price", "stock.levels", "inventory.import", "documents.scan", "documents.approve", "ai.wallet.view", "ai.usage.view", "ai.coins.purchase", "ai.wallet.manage"];

export function setRoleMatrix(matrix: Record<Role, Permission[]>) {
  (globalThis as Registry)[MATRIX_KEY] = matrix;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && value in PERMISSIONS;
}

export function isOutletScoped(role: string | null | undefined) {
  return isRole(role) && OUTLET_SCOPED_ROLES.includes(role);
}

/** Effective permissions: the role's live permissions plus any explicit per-user grants. */
export function effectivePermissions(role: string | null | undefined, grants: readonly string[] = []): Permission[] {
  if (!isRole(role)) return [];
  const fromRole = roleMatrix()[role];
  const extra = grants.filter(isPermission).filter((permission) => !(isOutletScoped(role) && CENTRAL_ONLY_PERMISSIONS.includes(permission)));
  return Array.from(new Set([...fromRole, ...extra]));
}

type Subject = string | null | undefined | { role: string; permissions?: readonly string[] };

/** Accepts a role (role defaults only) or an actor/session user carrying its effective permission list. */
export function can(subject: Subject, permission: Permission) {
  if (subject && typeof subject === "object") {
    if (subject.permissions) return subject.permissions.includes(permission);
    return effectivePermissions(subject.role).includes(permission);
  }
  return effectivePermissions(subject).includes(permission);
}

export function canAny(subject: Subject, permissions: readonly Permission[]) {
  return permissions.some((permission) => can(subject, permission));
}

/** Route prefix → permissions (any of) required to open the page. */
export const ROUTE_PERMISSIONS: { prefix: string; anyOf: Permission[] }[] = [
  { prefix: "/dashboard", anyOf: ["dashboard.view"] },
  { prefix: "/pos", anyOf: ["sales.create"] },
  { prefix: "/transfers", anyOf: ["stock.view"] },
  { prefix: "/notifications", anyOf: ["dashboard.view"] },
  { prefix: "/sales-overview", anyOf: ["reports.sales", "sales.view"] },
  { prefix: "/sales", anyOf: ["sales.view"] },
  { prefix: "/purchase", anyOf: ["purchase.view"] },
  { prefix: "/contacts", anyOf: ["contacts.view"] },
  { prefix: "/products/new", anyOf: ["products.manage"] },
  { prefix: "/products", anyOf: ["products.view"] },
  { prefix: "/inventory/import", anyOf: ["inventory.import"] },
  { prefix: "/data-migration", anyOf: ["documents.scan", "documents.approve", "inventory.import"] },
  { prefix: "/ai-wallet", anyOf: ["ai.wallet.view", "ai.usage.view", "ai.coins.purchase", "ai.wallet.manage"] },
  { prefix: "/inventory/offline", anyOf: ["stock.approve", "sales.supervise"] },
  { prefix: "/inventory", anyOf: ["stock.view"] },
  { prefix: "/stock-levels", anyOf: ["stock.levels", "stock.view"] },
  { prefix: "/stock", anyOf: ["stock.view"] },
  { prefix: "/alerts", anyOf: ["alerts.view"] },
  { prefix: "/finance", anyOf: ["finance.view"] },
  { prefix: "/billing", anyOf: ["finance.view"] },
  { prefix: "/outlets", anyOf: ["outlets.view"] },
  { prefix: "/reports", anyOf: ["reports.sales", "reports.inventory", "reports.financial"] },
  { prefix: "/regulatory", anyOf: ["regulatory.view"] },
  { prefix: "/audit", anyOf: ["audit.view"] },
  { prefix: "/users", anyOf: ["users.view"] },
  { prefix: "/permissions", anyOf: ["users.view"] },
  { prefix: "/settings", anyOf: ["settings.manage"] },
  { prefix: "/partners", anyOf: ["addons.view"] },
  { prefix: "/repairs", anyOf: ["addons.view"] },
  { prefix: "/sms", anyOf: ["addons.view"] },
  { prefix: "/email", anyOf: ["addons.view"] },
];

export function permissionsForPath(path: string): Permission[] | null {
  const pathname = path.split(/[?#]/)[0];
  const match = ROUTE_PERMISSIONS.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match?.anyOf ?? null;
}

export function canAccessPath(subject: Subject, pathname: string) {
  const required = permissionsForPath(pathname);
  return required ? canAny(subject, required) : true;
}
