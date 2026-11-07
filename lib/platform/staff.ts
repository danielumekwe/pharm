// Web365 staff accounts (platform_users), managed by Platform Super Admins.
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { hashPassword } from "@/lib/password";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";

export const staffSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().toLowerCase().email().max(160),
  role: z.enum(["PLATFORM_SUPER_ADMIN", "PLATFORM_SUPPORT"]),
});

export async function listStaff() {
  const rows = await platformQuery<Array<{ id: string; name: string; email: string; role: string; status: string; last_login_at: Date | null; created_at: Date }>>((query) =>
    query(`SELECT id, name, email, role, status, last_login_at, created_at FROM platform_users ORDER BY created_at`),
  );
  return rows.map((row) => ({ ...row, last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null, created_at: new Date(row.created_at).toISOString() }));
}

/** Creates a staff account with a one-time temporary password, shown once to the creating admin. */
export async function createStaff(actor: PlatformActor, input: z.infer<typeof staffSchema>) {
  const [existing] = await platformQuery<Array<{ id: string }>>((query) => query(`SELECT id FROM platform_users WHERE email = $1`, [input.email]));
  if (existing) throw new DomainError("A platform account with this email already exists.", 409);
  const temporaryPassword = `${randomBytes(9).toString("base64url")}7a`;
  const id = `puser-${randomUUID()}`;
  await platformQuery((query) => query(`INSERT INTO platform_users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)`, [id, input.email, input.name, input.role, hashPassword(temporaryPassword)]));
  await recordPlatformAudit(platformActorRef(actor), { action: "platform.staff-create", targetType: "PlatformUser", targetId: id, summary: `Created platform account ${input.name} <${input.email}> as ${input.role}`, severity: "warning" });
  return { id, temporaryPassword };
}

export async function setStaffStatus(actor: PlatformActor, id: string, status: "ACTIVE" | "SUSPENDED") {
  if (id === actor.id) throw new DomainError("You cannot change your own account's status.");
  const [row] = await platformQuery<Array<{ name: string; role: string }>>((query) => query(`SELECT name, role FROM platform_users WHERE id = $1`, [id]));
  if (!row) throw new DomainError("Platform account not found.", 404);
  if (status === "SUSPENDED" && row.role === "PLATFORM_SUPER_ADMIN") {
    const [{ n }] = await platformQuery<Array<{ n: string }>>((query) => query(`SELECT count(*) AS n FROM platform_users WHERE role = 'PLATFORM_SUPER_ADMIN' AND status = 'ACTIVE' AND id <> $1`, [id]));
    if (Number(n) === 0) throw new DomainError("Keep at least one active Platform Super Admin.");
  }
  await platformQuery((query) => query(`UPDATE platform_users SET status = $1, updated_at = now() WHERE id = $2`, [status, id]));
  await recordPlatformAudit(platformActorRef(actor), { action: status === "SUSPENDED" ? "platform.staff-suspend" : "platform.staff-reactivate", targetType: "PlatformUser", targetId: id, summary: `${status === "SUSPENDED" ? "Suspended" : "Reactivated"} platform account ${row.name}`, severity: "warning" });
  return { ok: true };
}
