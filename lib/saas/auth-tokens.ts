// Single-use account tokens (email verification, password reset). The raw token only ever exists in the
// link sent by email; the database keeps its SHA-256 hash, so a database leak does not leak usable links.
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { platformQuery } from "@/lib/db/database";

export type TokenPurpose = "verify_email" | "reset_password" | "join_pharmacy";

export const TOKEN_LIFETIME_MS: Record<TokenPurpose, number> = {
  verify_email: 48 * 3_600_000,
  reset_password: 60 * 60_000,
  join_pharmacy: 7 * 86_400_000,
};

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Issues a new token for the user (and, for pharmacy invitations, the pharmacy). Any earlier unused token for
 * the same purpose (and pharmacy) stops working.
 */
export async function issueToken(userId: string, purpose: TokenPurpose, options: { tenantId?: string; lifetimeMs?: number } = {}) {
  const token = randomBytes(32).toString("hex");
  await platformQuery(async (query) => {
    await query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND tenant_id IS NOT DISTINCT FROM $3`, [userId, purpose, options.tenantId ?? null]);
    await query(
      `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, tenant_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [`tok-${randomUUID()}`, userId, purpose, digest(token), new Date(Date.now() + (options.lifetimeMs ?? TOKEN_LIFETIME_MS[purpose])), options.tenantId ?? null],
    );
  });
  return token;
}

/** Marks a valid token used and returns its user (and pharmacy), or null when it is unknown, used or expired. */
export async function consumeToken(token: string, purpose: TokenPurpose): Promise<{ userId: string; tenantId: string | null } | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await platformQuery<Array<{ user_id: string; tenant_id: string | null }>>((query) =>
    query<{ user_id: string; tenant_id: string | null }>(
      `UPDATE auth_tokens SET used_at = now()
       WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id, tenant_id`,
      [digest(token), purpose],
    ),
  );
  return rows[0] ? { userId: rows[0].user_id, tenantId: rows[0].tenant_id } : null;
}

/** The user and pharmacy of a still-valid token, without using it. */
export async function peekToken(token: string, purpose: TokenPurpose): Promise<{ userId: string; tenantId: string | null } | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const [row] = await platformQuery<Array<{ user_id: string; tenant_id: string | null }>>((query) =>
    query<{ user_id: string; tenant_id: string | null }>(`SELECT user_id, tenant_id FROM auth_tokens WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()`, [digest(token), purpose]),
  );
  return row ? { userId: row.user_id, tenantId: row.tenant_id } : null;
}

/** Whether a token is currently valid, without using it (to show the reset form only for good links). */
export async function tokenIsValid(token: string, purpose: TokenPurpose) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const rows = await platformQuery<Array<{ id: string }>>((query) =>
    query<{ id: string }>(`SELECT id FROM auth_tokens WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()`, [digest(token), purpose]),
  );
  return rows.length > 0;
}
