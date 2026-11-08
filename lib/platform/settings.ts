// Central settings service.
//
// Three levels, kept apart:
// 1. Platform settings (this module, table platform_settings): controlled by Web365 staff with the right
//    platform permission. Secrets are stored encrypted (lib/platform/secrets.ts) and never returned.
// 2. Pharmacy settings: each pharmacy's own settings (app_state "settings", lib/erp/store.ts), controlled by
//    its Pharmacy Super Admin. Platform settings never overwrite them.
// 3. User preferences (table user_preferences): each person's own choices.
// Every platform change is validated on the server, recorded with secrets masked in
// platform_settings_history, and written to the platform audit trail.
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import { decryptSecrets, encryptSecrets, maskSecret } from "@/lib/platform/secrets";
import type { PlatformActor, PlatformPermission } from "@/lib/platform/session";

type Definition<P extends z.ZodTypeAny> = {
  label: string;
  /** Permission needed to change it (viewing the masked form needs the same). */
  permission: PlatformPermission;
  value: P;
  defaults: z.infer<P>;
  /** Secret fields: validated, encrypted, never returned. */
  secrets: Record<string, z.ZodString>;
};

const keyPattern = (prefix: string) => z.string().trim().regex(new RegExp(`^${prefix}[A-Za-z0-9]{10,}$`), `Must start with ${prefix}`);

export const SETTINGS = {
  "payments.paystack": {
    label: "Paystack",
    permission: "billing.manage",
    value: z.object({
      enabled: z.boolean(),
      mode: z.enum(["test", "live"]),
      testPublicKey: z.union([keyPattern("pk_test_"), z.literal("")]),
      livePublicKey: z.union([keyPattern("pk_live_"), z.literal("")]),
      currency: z.enum(["NGN", "GHS", "KES", "ZAR", "USD"]),
    }),
    defaults: { enabled: false, mode: "test", testPublicKey: "", livePublicKey: "", currency: "NGN" },
    secrets: { testSecretKey: keyPattern("sk_test_"), liveSecretKey: keyPattern("sk_live_") },
  },
  "email.delivery": {
    label: "Email delivery",
    permission: "settings.manage",
    value: z.object({
      /** Off: no email is sent at all (a kill switch), whatever the server environment says. */
      enabled: z.boolean(),
      provider: z.enum(["zeptomail_api", "zeptomail_smtp", "smtp"]),
      zeptoRegion: z.enum(["com", "eu", "in", "com.au", "jp", "ca", "sa"]),
      host: z.string().trim().max(200).regex(/^[a-z0-9.-]*$/i, "Enter a host name such as smtp.example.com"),
      port: z.number().int().min(1).max(65535),
      encryption: z.enum(["starttls", "ssl", "none"]),
      username: z.string().trim().max(200),
      senderName: z.string().trim().min(1).max(100),
      senderEmail: z.union([z.string().trim().toLowerCase().email(), z.literal("")]),
      replyTo: z.union([z.string().trim().toLowerCase().email(), z.literal("")]),
      /** Web365 address told about new pharmacy registrations (optional). */
      notifyEmail: z.union([z.string().trim().toLowerCase().email(), z.literal("")]),
    }).superRefine((value, context) => {
      if (value.enabled && !value.senderEmail) context.addIssue({ code: "custom", path: ["senderEmail"], message: "Enter the sender address before turning delivery on" });
      if (value.enabled && value.provider === "smtp" && !value.host) context.addIssue({ code: "custom", path: ["host"], message: "Enter the SMTP host" });
    }),
    defaults: { enabled: false, provider: "zeptomail_api", zeptoRegion: "com", host: "", port: 587, encryption: "starttls", username: "", senderName: "Pharmacy ERP", senderEmail: "", replyTo: "", notifyEmail: "" },
    secrets: {
      /** ZeptoMail "Send Mail" token, with or without the "Zoho-enczapikey" prefix. */
      apiToken: z.string().trim().regex(/^(Zoho-enczapikey\s+)?[A-Za-z0-9+/=]{20,}$/, "Paste the token from ZeptoMail (Mail Agents → API)"),
      password: z.string().min(1).max(500),
    },
  },
  "subscriptions.policy": {
    label: "Subscription policy",
    permission: "billing.manage",
    value: z.object({
      /** Days a paid subscription keeps working after its period ends without renewal (0: none). */
      graceDays: z.number().int().min(0).max(30),
      /** two_person: a refund needs a second billing administrator's approval. */
      refundApproval: z.enum(["two_person", "single"]),
      /** Days a closed pharmacy's data is kept before it may be purged. */
      closedRetentionDays: z.number().int().min(30).max(3650),
    }),
    defaults: { graceDays: 3, refundApproval: "two_person", closedRetentionDays: 90 },
    secrets: {},
  },
  "security.policy": {
    label: "Platform security policy",
    permission: "staff.manage",
    value: z.object({
      /** Every platform staff member must use an authenticator app (they are asked to set it up at sign-in). */
      requireTwoFactor: z.boolean(),
      sessionHours: z.number().int().min(1).max(24),
      /** Signed out after this long without activity. */
      idleMinutes: z.number().int().min(5).max(480),
      /** Failed platform sign-ins (password or code) before the account is locked for lockoutMinutes. */
      maxFailedAttempts: z.number().int().min(3).max(20),
      lockoutMinutes: z.number().int().min(5).max(1440),
      /** Addresses (or CIDR ranges) allowed to use the Control Centre; empty: any address. */
      ipAllowlist: z.array(z.string().trim().refine(isCidr, "Enter an IP address or range such as 102.89.0.0/16")).max(50),
    }),
    defaults: { requireTwoFactor: false, sessionHours: 8, idleMinutes: 60, maxFailedAttempts: 5, lockoutMinutes: 15, ipAllowlist: [] as string[] },
    secrets: {},
  },
  "system.config": {
    label: "System settings",
    permission: "settings.manage",
    value: z.object({
      /** Maintenance: pharmacy sign-in, pages and APIs pause with this message. The Control Centre keeps working. */
      maintenance: z.boolean(),
      maintenanceMessage: z.string().trim().max(300),
      /** New pharmacies can register themselves (Web365 can still create them). */
      registrationOpen: z.boolean(),
      /** Off: new pharmacies must pay before using the system. */
      trialsEnabled: z.boolean(),
      /** Trial length for new registrations; null: each plan's own trial days. */
      trialDaysOverride: z.number().int().min(1).max(90).nullable(),
      /** Platform-wide switches; off overrides every plan. */
      features: z.object({ stock_transfers: z.boolean(), regulatory_management: z.boolean() }),
      maxDocumentMB: z.number().int().min(1).max(10),
      documentTypes: z.array(z.enum(["pdf", "png", "jpeg"])).min(1).max(3),
      maxLogoKB: z.number().int().min(64).max(2048),
      jobs: z.object({ alertJobs: z.boolean(), emailQueue: z.boolean() }),
    }),
    defaults: {
      maintenance: false, maintenanceMessage: "", registrationOpen: true, trialsEnabled: true, trialDaysOverride: null as number | null,
      features: { stock_transfers: true, regulatory_management: true }, maxDocumentMB: 5, documentTypes: ["pdf", "png", "jpeg"] as Array<"pdf" | "png" | "jpeg">,
      maxLogoKB: 512, jobs: { alertJobs: true, emailQueue: true },
    },
    secrets: {},
  },
  "branding.app": {
    label: "Application branding",
    permission: "settings.manage",
    value: z.object({
      /** The product name in emails, page titles of help pages and the sign-in page. */
      appName: z.string().trim().min(2).max(60),
      supportEmail: z.union([z.string().trim().toLowerCase().email(), z.literal("")]),
      supportPhone: z.string().trim().max(40),
      loginTagline: z.string().trim().max(160),
    }),
    defaults: { appName: "Pharmacy ERP", supportEmail: "", supportPhone: "", loginTagline: "" },
    secrets: {},
  },
  "notifications.global": {
    label: "Notification switches",
    permission: "settings.manage",
    value: z.object({
      /** Stock, expiry and summary emails sent by pharmacies' alert settings. */
      pharmacyAlertEmails: z.boolean(),
      /** Android push notifications. */
      pushNotifications: z.boolean(),
      /** Payment confirmations and failures. Account emails (confirm, reset, invitations) are always sent. */
      billingEmails: z.boolean(),
      /** Announcements sent by email. */
      announcementEmails: z.boolean(),
    }),
    defaults: { pharmacyAlertEmails: true, pushNotifications: true, billingEmails: true, announcementEmails: true },
    secrets: {},
  },
} satisfies Record<string, Definition<z.ZodTypeAny>>;

function isCidr(value: string) {
  const [address, bits, extra] = value.split("/");
  if (extra !== undefined) return false;
  const family = isIP(address);
  if (!family) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (family === 4 ? 32 : 128);
}

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["value"]>;

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS;
}

type Row = { key: string; value: unknown; secret_ciphertext: string | null; updated_at: Date; updated_by: string | null };

/** Server-only: the setting with its secrets decrypted. Never send this to a browser. */
export async function readPlatformSetting<K extends SettingKey>(key: K): Promise<{ value: SettingValue<K>; secrets: Record<string, string>; updatedAt: string | null }> {
  const definition = SETTINGS[key];
  const [row] = await platformQuery<Row[]>((query) => query<Row>(`SELECT * FROM platform_settings WHERE key = $1`, [key]));
  const stored = row?.value && typeof row.value === "object" ? row.value : {};
  const parsed = definition.value.safeParse({ ...definition.defaults, ...stored });
  return {
    value: (parsed.success ? parsed.data : definition.defaults) as SettingValue<K>,
    secrets: row?.secret_ciphertext ? decryptSecrets(row.secret_ciphertext) : {},
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
  };
}

/** For screens: values, secrets as "set / ending in …" only, and the change history. */
export async function describePlatformSetting<K extends SettingKey>(key: K) {
  const definition = SETTINGS[key];
  const { value, secrets, updatedAt } = await readPlatformSetting(key).catch((error) => {
    if (error instanceof Error && error.name === "SecretsUnavailableError") return { value: definition.defaults as SettingValue<K>, secrets: {} as Record<string, string>, updatedAt: null };
    throw error;
  });
  const history = await platformQuery<Array<{ changed_at: Date; changed_by_name: string; changes: unknown }>>((query) =>
    query(`SELECT changed_at, changed_by_name, changes FROM platform_settings_history WHERE key = $1 ORDER BY changed_at DESC LIMIT 25`, [key]),
  );
  return {
    key,
    label: definition.label,
    value,
    secrets: Object.fromEntries(Object.keys(definition.secrets).map((name) => [name, maskSecret(secrets[name])])),
    updatedAt,
    history: history.map((entry) => ({ at: new Date(entry.changed_at).toISOString(), by: entry.changed_by_name, changes: entry.changes as string[] })),
  };
}

/**
 * Updates a platform setting. Secrets: a new string replaces the stored one, "" or absent keeps it, null clears
 * it. Every accepted change is recorded (secrets only as "set", "replaced" or "cleared").
 */
export async function updatePlatformSetting<K extends SettingKey>(actor: PlatformActor, key: K, input: { value?: Partial<SettingValue<K>>; secrets?: Record<string, string | null | undefined> }) {
  const definition = SETTINGS[key];
  const current = await readPlatformSetting(key);
  const parsed = definition.value.safeParse({ ...current.value, ...(input.value ?? {}) });
  if (!parsed.success) throw new DomainError(`Check ${parsed.error.issues[0]?.path.join(".") || "the form"}: ${parsed.error.issues[0]?.message ?? "invalid value"}.`, 422);
  const value = parsed.data as Record<string, unknown>;

  const secrets = { ...current.secrets };
  const changes: string[] = [];
  for (const [name, incoming] of Object.entries(input.secrets ?? {})) {
    const schema = (definition.secrets as Record<string, z.ZodString>)[name];
    if (!schema) throw new DomainError(`Unknown secret field ${name}.`, 422);
    if (incoming === undefined || incoming === "") continue;
    if (incoming === null) {
      if (secrets[name]) changes.push(`${name} cleared`);
      delete secrets[name];
      continue;
    }
    const check = schema.safeParse(incoming);
    if (!check.success) throw new DomainError(`Check ${name}: ${check.error.issues[0]?.message ?? "invalid value"}.`, 422);
    changes.push(`${name} ${secrets[name] ? "replaced" : "set"}`);
    secrets[name] = check.data;
  }
  for (const [field, next] of Object.entries(value)) {
    const before = (current.value as Record<string, unknown>)[field];
    if (JSON.stringify(before) !== JSON.stringify(next)) changes.push(`${field}: ${JSON.stringify(before)} → ${JSON.stringify(next)}`);
  }
  if (!changes.length) return describePlatformSetting(key);

  const ciphertext = Object.keys(secrets).length ? encryptSecrets(secrets) : null;
  await platformQuery(async (query) => {
    await query(
      `INSERT INTO platform_settings (key, value, secret_ciphertext, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, secret_ciphertext = EXCLUDED.secret_ciphertext, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), ciphertext, actor.id],
    );
    await query(`INSERT INTO platform_settings_history (id, key, changed_by, changed_by_name, changes) VALUES ($1, $2, $3, $4, $5)`, [`set-${randomUUID()}`, key, actor.id, actor.name, JSON.stringify(changes)]);
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "settings.update", targetType: "Setting", targetId: key, summary: `${definition.label} settings changed: ${changes.join("; ")}`, severity: "warning" });
  return describePlatformSetting(key);
}

// ------------------------------------------------------------------ integration checks

/** Records the result of a real connection check (the only source of a "connected" status). */
export async function recordIntegrationCheck(integration: string, ok: boolean, detail: string, checkedBy: string | null) {
  await platformQuery((query) => query(`INSERT INTO integration_checks (id, integration, ok, detail, checked_by) VALUES ($1, $2, $3, $4, $5)`, [`chk-${randomUUID()}`, integration, ok, detail.slice(0, 500), checkedBy]));
}

export async function lastChecks(integration: string) {
  const rows = await platformQuery<Array<{ checked_at: Date; ok: boolean; detail: string }>>((query) =>
    query(`SELECT checked_at, ok, detail FROM integration_checks WHERE integration = $1 ORDER BY checked_at DESC LIMIT 20`, [integration]),
  );
  const last = rows[0] ?? null;
  const lastOk = rows.find((row) => row.ok) ?? null;
  const lastError = rows.find((row) => !row.ok) ?? null;
  const iso = (row: { checked_at: Date } | null) => (row ? new Date(row.checked_at).toISOString() : null);
  return { last: last ? { at: iso(last), ok: last.ok, detail: last.detail } : null, lastSuccessAt: iso(lastOk), lastError: lastError ? { at: iso(lastError), detail: lastError.detail } : null };
}

// ------------------------------------------------------------------ user preferences (level 3)

export const userPreferencesSchema = z.object({
  dateFormat: z.enum(["dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"]).optional(),
  language: z.enum(["en"]).optional(),
  compactTables: z.boolean().optional(),
});

export async function readUserPreferences(userId: string) {
  const [row] = await platformQuery<Array<{ value: unknown }>>((query) => query(`SELECT value FROM user_preferences WHERE user_id = $1`, [userId]));
  const parsed = userPreferencesSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : {};
}

export async function updateUserPreferences(userId: string, input: unknown) {
  const next = { ...(await readUserPreferences(userId)), ...userPreferencesSchema.parse(input) };
  await platformQuery((query) => query(`INSERT INTO user_preferences (user_id, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [userId, JSON.stringify(next)]));
  return next;
}
