// Platform-level identity: who a person is (global account) and which pharmacies they may enter
// (memberships). Used before a tenant is chosen — sign-in, the pharmacy picker, the mobile app — so it reads
// the global tables directly instead of a tenant's working set, and reads each tenant's outlets in that
// tenant's own Row Level Security scope.
import { platformQuery } from "@/lib/db/database";
import { verifyPassword } from "@/lib/password";
import { isOutletScoped, isRole, ROLE_LABELS } from "@/lib/rbac";

export const HEAD_OFFICE = "HQ";

export type PharmacyLocation = { id: string; name: string };
export type PharmacyChoice = {
  tenantId: string;
  name: string;
  role: string;
  roleLabel: string;
  status: string;
  /** Locations this person may sign in to; HEAD_OFFICE first for central roles. */
  locations: PharmacyLocation[];
  defaultLocationId: string | null;
};

type AccountRow = { id: string; password: string | null; password_hash: string | null };

/**
 * IDs of the accounts the identifier names (an email, or a staff ID within any pharmacy) whose password is
 * correct. Usually one; a staff ID shared by two pharmacies can name two different people.
 */
export async function verifiedAccountIds(identifier: string, password: string): Promise<string[]> {
  const rows = await platformQuery<AccountRow[]>((query) =>
    query<AccountRow>(
      `SELECT DISTINCT u.id, u.password, u.password_hash FROM users u
       LEFT JOIN tenant_memberships m ON m.user_id = u.id
       WHERE lower(u.email) = lower($1) OR lower(m.staff_id) = lower($1)`,
      [identifier.trim()],
    ),
  );
  return rows.filter((row) => (row.password && row.password === password) || verifyPassword(password, row.password_hash)).map((row) => row.id);
}

/** Accounts the identifier names, without checking the password (for recording failed sign-ins). */
export async function accountIdsFor(identifier: string): Promise<string[]> {
  const rows = await platformQuery<{ id: string }[]>((query) =>
    query<{ id: string }>(
      `SELECT DISTINCT u.id FROM users u LEFT JOIN tenant_memberships m ON m.user_id = u.id WHERE lower(u.email) = lower($1) OR lower(m.staff_id) = lower($1)`,
      [identifier.trim()],
    ),
  );
  return rows.map((row) => row.id);
}

type MembershipRow = { tenant_id: string; user_id: string; tenant_name: string; role: string; status: string; default_outlet_id: string | null };

/**
 * Every pharmacy membership of these accounts in an active pharmacy, with the locations each may sign in
 * to. Deactivated memberships are left out.
 */
export async function pharmaciesFor(userIds: string[]): Promise<Array<PharmacyChoice & { userId: string }>> {
  if (!userIds.length) return [];
  return platformQuery(async (query) => {
    const memberships = await query<MembershipRow>(
      `SELECT m.tenant_id, m.user_id, t.name AS tenant_name, m.role, m.status, m.default_outlet_id
       FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = ANY($1::text[]) AND t.status = 'ACTIVE' AND m.status <> 'DEACTIVATED'
       ORDER BY t.name`,
      [userIds],
    );
    const choices: Array<PharmacyChoice & { userId: string }> = [];
    for (const membership of memberships) {
      const tenantId = membership.tenant_id;
      // Read in the tenant's own RLS scope: only that pharmacy's outlets are visible.
      const outlets = await query<{ id: string; name: string }>(
        `SELECT id, name FROM outlets WHERE tenant_id = $1 AND COALESCE(status, 'OPEN') <> 'CLOSED' ORDER BY seq`,
        [tenantId],
        tenantId,
      );
      let locations: PharmacyLocation[];
      if (isRole(membership.role) && isOutletScoped(membership.role)) {
        const assigned = await query<{ outlet_id: string }>(
          `SELECT outlet_id FROM user_outlets WHERE tenant_id = $1 AND user_id = $2 ORDER BY position`,
          [tenantId, membership.user_id],
          tenantId,
        );
        const ids = assigned.length ? assigned.map((row) => row.outlet_id) : membership.default_outlet_id ? [membership.default_outlet_id] : [];
        locations = outlets.filter((outlet) => ids.includes(outlet.id));
      } else {
        locations = [{ id: HEAD_OFFICE, name: "Head Office / All Outlets" }, ...outlets];
      }
      choices.push({
        userId: membership.user_id,
        tenantId,
        name: membership.tenant_name,
        role: membership.role,
        roleLabel: isRole(membership.role) ? ROLE_LABELS[membership.role] : membership.role,
        status: membership.status,
        locations,
        defaultLocationId: locations.some((location) => location.id === membership.default_outlet_id) ? membership.default_outlet_id : locations[0]?.id ?? null,
      });
    }
    return choices;
  });
}

/** The tenant a signed-in user switches to, if they hold an active membership of that active pharmacy. */
export async function activeMembership(userId: string, tenantId: string) {
  const [row] = await platformQuery<Array<{ tenant_id: string }>>((query) =>
    query<{ tenant_id: string }>(
      `SELECT m.tenant_id FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.status = 'ACTIVE' AND t.status = 'ACTIVE'`,
      [userId, tenantId],
    ),
  );
  return Boolean(row);
}

/** Pharmacies (id and name) a user holds an active membership of, for the pharmacy switcher. */
export async function pharmacyNames(userId: string) {
  return platformQuery<Array<{ id: string; name: string }>>((query) =>
    query<{ id: string; name: string }>(
      `SELECT t.id, t.name FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND t.status = 'ACTIVE' ORDER BY t.name`,
      [userId],
    ),
  );
}

/**
 * The pharmacy an invitation link belongs to. The token is the secret; the pharmacy comes from the invitation
 * itself (or, for invitations issued before multi-tenancy, the account's pending membership).
 */
export async function invitationTenant(token: string): Promise<string | null> {
  if (!/^[a-f0-9]{20,100}$/.test(token)) return null;
  const [row] = await platformQuery<Array<{ invite: string | null; invited_tenant: string | null }>>((query) =>
    query<{ invite: string | null; invited_tenant: string | null }>(
      `SELECT u.invite,
              (SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = u.id AND m.status = 'INVITED' ORDER BY m.updated_at DESC LIMIT 1) AS invited_tenant
       FROM users u WHERE u.invite IS NOT NULL AND (u.invite::json ->> 'token') = $1`,
      [token],
    ),
  );
  if (!row?.invite) return null;
  const invite = JSON.parse(row.invite) as { tenantId?: string };
  return invite.tenantId ?? row.invited_tenant ?? null;
}

/** True if another account (any pharmacy) already uses this email. Emails identify people platform-wide. */
export async function emailTaken(email: string, exceptUserId?: string) {
  const rows = await platformQuery<Array<{ id: string }>>((query) =>
    query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2`, [email.trim(), exceptUserId ?? ""]),
  );
  return rows.length > 0;
}

/** True if the person also belongs to a pharmacy other than tenantId. */
export async function sharedWithOtherPharmacies(userId: string, tenantId: string) {
  const rows = await platformQuery<Array<{ tenant_id: string }>>((query) =>
    query<{ tenant_id: string }>(`SELECT tenant_id FROM tenant_memberships WHERE user_id = $1 AND tenant_id <> $2 AND status <> 'DEACTIVATED' LIMIT 1`, [userId, tenantId]),
  );
  return rows.length > 0;
}
