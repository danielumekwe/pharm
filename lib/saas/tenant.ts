// Tenant identity used by the persistence layer.
//
// Phase 1: there is one tenant (the existing demo pharmacy), so every request runs as DEFAULT_TENANT_ID.
// Phase 2 replaces currentTenantId() with the tenant resolved from the signed-in user's validated
// membership. Nothing here reads a tenant ID from a request body, query string or header.

/** The pharmacy that owned all data before the SaaS conversion. */
export const DEFAULT_TENANT_ID = "tenant-demo";

/** Reserved app_state scope for platform-wide rows (the write lock, the seed marker). Not a tenant. */
export const PLATFORM_SCOPE = "_platform";

/** app_state keys that belong to the platform rather than to a tenant. */
export const PLATFORM_STATE_KEYS = new Set(["__pharm_write_lock", "seededAt"]);

/** The tenant whose data the current transaction may load and write. */
export function currentTenantId(): string {
  return DEFAULT_TENANT_ID;
}

/** Membership row id for a user inside a tenant (stable, so upserts are idempotent). */
export function membershipId(tenantId: string, userId: string) {
  return `mem-${tenantId}-${userId}`;
}
