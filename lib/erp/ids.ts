import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/saas/tenant";

/**
 * A record ID that is unique across the whole platform. Counters restart for every pharmacy, so other
 * pharmacies' IDs carry their tenant ID (`aud-t-x7k2p9-1`); the demo pharmacy keeps its historic format
 * (`aud-26`) so its existing and new IDs read the same.
 */
export function newId(prefix: string, unique: string | number) {
  const tenantId = currentTenantId();
  return tenantId === DEFAULT_TENANT_ID ? `${prefix}-${unique}` : `${prefix}-${tenantId}-${unique}`;
}
