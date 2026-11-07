// Single-use account tokens (email verification, password reset). The raw token only ever exists in the
// link sent by email; the database keeps its SHA-256 hash, so a database leak does not leak usable links.
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { platformQuery } from "@/lib/db/database";

export type TokenPurpose = "verify_email" | "reset_password";

export const TOKEN_LIFETIME_MS: Record<TokenPurpose, number> = {
  verify_email: 48 * 3_600_000,
  reset_password: 60 * 60_000,
};

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Issues a new token for the user. Any earlier unused token for the same purpose stops working. */
export async function issueToken(userId: string, purpose: TokenPurpose) {
  const token = randomBytes(32).toString("hex");
  await platformQuery(async (query) => {
    await query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
    await query(
      `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [`tok-${randomUUID()}`, userId, purpose, digest(token), new Date(Date.now() + TOKEN_LIFETIME_MS[purpose])],
    );
  });
  return token;
}

/** Marks a valid token used and returns its user, or null when it is unknown, used or expired. */
export async function consumeToken(token: string, purpose: TokenPurpose): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await platformQuery<Array<{ user_id: string }>>((query) =>
    query<{ user_id: string }>(
      `UPDATE auth_tokens SET used_at = now()
       WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [digest(token), purpose],
    ),
  );
  return rows[0]?.user_id ?? null;
}

/** Whether a token is currently valid, without using it (to show the reset form only for good links). */
export async function tokenIsValid(token: string, purpose: TokenPurpose) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const rows = await platformQuery<Array<{ id: string }>>((query) =>
    query<{ id: string }>(`SELECT id FROM auth_tokens WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()`, [digest(token), purpose]),
  );
  return rows.length > 0;
}
