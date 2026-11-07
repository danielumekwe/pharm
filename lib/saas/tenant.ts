// Tenant scope for server code.
//
// Every database transaction belongs to exactly one tenant (pharmacy) or to nobody (anonymous requests).
// The tenant is set server-side only:
// - explicitly with runInTenant() by sign-in (after the membership is verified), background jobs, and
//   invitation acceptance;
// - otherwise from the signed session or mobile token of the current request (lib/saas/request-tenant.ts).
// Nothing reads a tenant ID from a request body, query string or custom header.
import { AsyncLocalStorage } from "node:async_hooks";

/** The pharmacy that owned all data before the SaaS conversion. */
export const DEFAULT_TENANT_ID = "tenant-demo";

/** Reserved app_state scope for platform-wide rows (the write lock, the seed marker). Not a tenant. */
export const PLATFORM_SCOPE = "_platform";

/** app_state keys that belong to the platform rather than to a tenant. */
export const PLATFORM_STATE_KEYS = new Set(["__pharm_write_lock", "seededAt"]);

type Scope = { tenantId: string | null };
const registry = globalThis as typeof globalThis & { __pharmTenantScope?: AsyncLocalStorage<Scope> };
const scope = (registry.__pharmTenantScope ??= new AsyncLocalStorage<Scope>());

export class TenantRequiredError extends Error {
  constructor(message = "This action needs a signed-in pharmacy account.") {
    super(message);
    this.name = "TenantRequiredError";
  }
}

/** Runs fn for one tenant (or for nobody, with null). Inner code and its database transaction use this tenant. */
export function runInTenant<T>(tenantId: string | null, fn: () => T): T {
  return scope.run({ tenantId }, fn);
}

/** The explicitly scoped tenant: a tenant ID, null for an anonymous scope, undefined when no scope was set. */
export function scopedTenantId(): string | null | undefined {
  return scope.getStore()?.tenantId;
}

/** The current tenant. Throws when the code runs for nobody, so writes can never land without a tenant. */
export function currentTenantId(): string {
  const tenantId = scope.getStore()?.tenantId;
  if (!tenantId) throw new TenantRequiredError();
  return tenantId;
}

/** Membership row id for a user inside a tenant (stable, so upserts are idempotent). */
export function membershipId(tenantId: string, userId: string) {
  return `mem-${tenantId}-${userId}`;
}
