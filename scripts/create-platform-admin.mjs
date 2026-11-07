// Creates a Web365 platform account (normally the first Platform Super Admin; later ones are created in the
// platform UI). The password comes from PLATFORM_ADMIN_PASSWORD, or a strong one is generated and printed once.
//
//   DATABASE_URL=… node scripts/create-platform-admin.mjs --email ops@web365.ng --name "Ada Obi" [--role PLATFORM_SUPPORT]
//   Remote databases (e.g. Neon) also need --confirm-remote.
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";

import { connectionFromEnv, parseArgs } from "./db-tools.mjs";

const args = parseArgs(process.argv.slice(2));
const email = String(args.email ?? "").trim().toLowerCase();
const name = String(args.name ?? "").trim();
const role = String(args.role ?? "PLATFORM_SUPER_ADMIN");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 3) throw new Error("Pass --email and --name (at least 3 characters).");
if (!["PLATFORM_SUPER_ADMIN", "PLATFORM_SUPPORT", "BILLING_ADMIN", "TECHNICAL_ADMIN"].includes(role)) throw new Error("--role must be PLATFORM_SUPER_ADMIN, PLATFORM_SUPPORT, BILLING_ADMIN or TECHNICAL_ADMIN.");
const generated = !process.env.PLATFORM_ADMIN_PASSWORD;
const password = process.env.PLATFORM_ADMIN_PASSWORD ?? `${randomBytes(15).toString("base64url")}9a`;
if (password.length < 12) throw new Error("PLATFORM_ADMIN_PASSWORD must be at least 12 characters.");

// Same format as lib/password.ts: PBKDF2-SHA256, 310,000 iterations, "salt:hash".
const salt = randomBytes(16).toString("hex");
const hash = `${salt}:${pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex")}`;

const client = new pg.Client({ connectionString: connectionFromEnv(args) });
await client.connect();
try {
  const { rows } = await client.query("SELECT id FROM platform_users WHERE email = $1", [email]);
  if (rows.length) throw new Error(`A platform account for ${email} already exists.`);
  const id = `puser-${randomUUID()}`;
  await client.query("INSERT INTO platform_users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)", [id, email, name, role, hash]);
  await client.query(
    "INSERT INTO platform_audit_events (id, actor_name, actor_type, action, target_type, target_id, summary, severity) VALUES ($1, 'create-platform-admin script', 'system', 'platform.staff-create', 'PlatformUser', $2, $3, 'warning')",
    [`paud-${randomUUID()}`, id, `Created platform account ${name} <${email}> as ${role} from the command line`],
  );
  console.log(`Created ${role} ${name} <${email}>. Sign in at /platform/login.`);
  if (generated) console.log(`Temporary password (shown once): ${password}`);
} finally {
  await client.end();
}
