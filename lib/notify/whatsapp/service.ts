// WhatsApp notifications (Zoho CPaaS): templates, pharmacy preferences and recipients, the message queue,
// connection tests and delivery webhooks. Server only.
//
// Rules this module enforces:
// - Nothing is sent while a request (POS sale, payment, page) is being handled: events only queue messages;
//   the background queue (runPlatformJobs) sends them. The only exception is the Control Centre's explicit
//   "Send test message".
// - Only templates Web365 has marked APPROVED (after checking them in Zoho) and active are sent.
// - Only to recipients a pharmacy added with recorded consent, who have not opted out, for the types they chose.
// - Each notification is queued once (dedupe_key); retries reuse the same row; permanent failures stop.
// - Credentials and template values never leave the server; values are stored encrypted until sent.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { AUTH_SECRET } from "@/lib/auth-secret";
import { after } from "next/server";

import { outsideTransaction, platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { decryptSecrets, encryptSecrets, secretsAvailable } from "@/lib/platform/secrets";
import { readPlatformSetting, recordIntegrationCheck, type SettingValue } from "@/lib/platform/settings";

import { isNotificationType, NOTIFICATION_TYPES, TYPE_KEYS, type NotificationType } from "./catalog";
import { getLogs, sendTemplate, type WebhookEvent } from "./zoho";

type Settings = SettingValue<"whatsapp.zoho">;
export type MessageCategory = NotificationType | "test";

const RETRY_DELAYS_MINUTES = [1, 5, 30, 120];
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
/** A message not sent within this time is dropped (a stale daily report or alert is no use to anyone). */
const EXPIRE_AFTER_HOURS = 24;
/** A row left in SENDING this long (a crashed worker) is reconciled with Zoho's logs before any resend. */
const STALE_SENDING_MINUTES = 10;
const ALERT_TYPES: NotificationType[] = ["low_stock", "out_of_stock", "expiry"];

function appUrl() {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
}

// ------------------------------------------------------------------ configuration

export async function whatsappConfig() {
  const setting = await readPlatformSetting("whatsapp.zoho");
  const apiKey = setting.secrets.apiKey ?? "";
  return { value: setting.value, apiKey, webhookKey: setting.secrets.webhookKey ?? "", saved: Boolean(setting.updatedAt) };
}

const zohoClient = (value: Settings, apiKey: string) => ({ baseUrl: value.baseUrl, apiKey, agentId: value.agentId || undefined });

/** Normalises a phone number to international format, using the default country code for local numbers. */
export function normalisePhone(input: string, defaultCountryCode: string) {
  const compact = input.replace(/[\s().-]/g, "");
  let phone = compact;
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  else if (!phone.startsWith("+")) phone = phone.startsWith("0") ? `+${defaultCountryCode}${phone.slice(1)}` : `+${defaultCountryCode}${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new DomainError(`"${input}" is not a valid phone number. Use international format, e.g. +2348012345678.`, 422);
  return phone;
}

// ------------------------------------------------------------------ templates (platform)

const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  notificationType: z.string().refine(isNotificationType, "Choose a notification type"),
  templateKey: z.string().trim().max(500).optional().default(""),
  templateAlias: z.string().trim().max(100).optional().default(""),
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use a language code such as en or en_US").default("en"),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]).default("UTILITY"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAUSED"]),
  statusNote: z.string().trim().max(300).optional().default(""),
  variables: z.array(z.string().trim().regex(/^[A-Za-z0-9_]{1,60}$/, "Variable names: letters, numbers and _")).max(20),
  active: z.boolean().default(true),
});
export type TemplateInput = z.input<typeof templateSchema>;

type TemplateRow = { id: string; name: string; notification_type: string; template_key: string | null; template_alias: string | null; language: string; category: string; status: string; status_note: string | null; variables: string[]; active: boolean; updated_at: Date; updated_by: string | null };

export async function listTemplates() {
  return platformQuery<TemplateRow[]>((query) => query(`SELECT * FROM whatsapp_templates ORDER BY notification_type, name`));
}

/** Creates or updates a template record. Its variables must all be ones its notification type provides. */
export async function saveTemplate(actorName: string, id: string | null, input: unknown) {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(`Check ${parsed.error.issues[0]?.path.join(".") || "the form"}: ${parsed.error.issues[0]?.message ?? "invalid value"}.`, 422);
  const data = parsed.data;
  const type = data.notificationType as NotificationType;
  if (Boolean(data.templateKey) === Boolean(data.templateAlias)) throw new DomainError("Enter either the template key or the template alias from Zoho CPaaS (not both).", 422);
  const allowed = NOTIFICATION_TYPES[type].variables as readonly string[];
  const unknown = data.variables.filter((name) => !allowed.includes(name));
  if (unknown.length) throw new DomainError(`${NOTIFICATION_TYPES[type].label} cannot fill: ${unknown.join(", ")}. Available: ${allowed.join(", ")}.`, 422);
  const values = [data.name, type, data.templateKey || null, data.templateAlias || null, data.language, data.category, data.status, data.statusNote || null, JSON.stringify([...new Set(data.variables)]), data.active, actorName];
  if (id) {
    const rows = await platformQuery<TemplateRow[]>((query) =>
      query(
        `UPDATE whatsapp_templates SET name = $1, notification_type = $2, template_key = $3, template_alias = $4, language = $5, category = $6, status = $7, status_note = $8,
                variables = $9, active = $10, updated_by = $11, updated_at = now() WHERE id = $12 RETURNING *`,
        [...values, id],
      ),
    );
    if (!rows[0]) throw new DomainError("Template not found.", 404);
    return rows[0];
  }
  const [row] = await platformQuery<TemplateRow[]>((query) =>
    query(
      `INSERT INTO whatsapp_templates (name, notification_type, template_key, template_alias, language, category, status, status_note, variables, active, updated_by, id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [...values, `wat-${randomUUID()}`],
    ),
  );
  return row;
}

/** Why a type cannot be sent right now, or null when an approved, active template exists. */
export function templateProblem(templates: TemplateRow[], type: NotificationType) {
  const own = templates.filter((row) => row.notification_type === type);
  if (own.some((row) => row.active && row.status === "APPROVED")) return null;
  if (!own.length) return `No WhatsApp template is set up for "${NOTIFICATION_TYPES[type].label}". Add the Zoho template in Control Centre → WhatsApp.`;
  const pending = own.find((row) => row.status === "PENDING");
  if (pending) return `The template "${pending.name}" is waiting for approval. It is used once it is approved in Zoho CPaaS / Meta and marked Approved here.`;
  const rejected = own.find((row) => row.status === "REJECTED");
  if (rejected) return `The template "${rejected.name}" was rejected${rejected.status_note ? ` (${rejected.status_note})` : ""}. Fix it in Zoho CPaaS and submit it again.`;
  return `The template for "${NOTIFICATION_TYPES[type].label}" is paused or inactive.`;
}

async function approvedTemplate(type: NotificationType) {
  const [row] = await platformQuery<TemplateRow[]>((query) =>
    query(`SELECT * FROM whatsapp_templates WHERE notification_type = $1 AND status = 'APPROVED' AND active ORDER BY updated_at DESC LIMIT 1`, [type]),
  );
  return row ?? null;
}

// ------------------------------------------------------------------ pharmacy preferences and recipients

export type TenantPreferences = { dailyReportChannel: "email" | "whatsapp" | "both"; types: Record<NotificationType, boolean> };

export async function tenantPreferences(tenantId: string): Promise<TenantPreferences> {
  const [row] = await platformQuery<Array<{ daily_report_channel: TenantPreferences["dailyReportChannel"]; types: Record<string, boolean> }>>((query) =>
    query(`SELECT daily_report_channel, types FROM whatsapp_tenant_settings WHERE tenant_id = $1`, [tenantId]),
  );
  const types = Object.fromEntries(TYPE_KEYS.map((key) => [key, row?.types?.[key] !== false])) as Record<NotificationType, boolean>;
  return { dailyReportChannel: row?.daily_report_channel ?? "email", types };
}

const preferencesSchema = z.object({
  dailyReportChannel: z.enum(["email", "whatsapp", "both"]).optional(),
  types: z.record(z.string(), z.boolean()).optional(),
});

export async function updateTenantPreferences(tenantId: string, userName: string, input: unknown) {
  const parsed = preferencesSchema.parse(input);
  const current = await tenantPreferences(tenantId);
  const types = { ...current.types };
  for (const [key, on] of Object.entries(parsed.types ?? {})) if (isNotificationType(key)) types[key] = on;
  const channel = parsed.dailyReportChannel ?? current.dailyReportChannel;
  await platformQuery((query) =>
    query(
      `INSERT INTO whatsapp_tenant_settings (tenant_id, daily_report_channel, types, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (tenant_id) DO UPDATE SET daily_report_channel = EXCLUDED.daily_report_channel, types = EXCLUDED.types, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [tenantId, channel, JSON.stringify(types), userName],
    ),
  );
  return tenantPreferences(tenantId);
}

type RecipientRow = { id: string; tenant_id: string; name: string; phone: string; types: string[]; outlet_id: string | null; consent_at: Date; consent_by: string; consent_note: string | null; opted_out_at: Date | null; opt_out_source: string | null; created_at: Date };

/** This pharmacy's recipients only (tenantId always comes from the signed-in session or the job's tenant). */
export async function listRecipients(tenantId: string) {
  return platformQuery<RecipientRow[]>((query) => query(`SELECT * FROM whatsapp_recipients WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]));
}

const recipientSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(6).max(30),
  types: z.array(z.string().refine(isNotificationType, "Unknown notification type")).min(1, "Choose at least one notification type").max(TYPE_KEYS.length),
  outletId: z.string().trim().max(60).nullable().optional(),
  consent: z.literal(true, { message: "Confirm that this person agreed to receive WhatsApp messages" }),
  consentNote: z.string().trim().max(300).optional(),
});

export async function addRecipient(tenantId: string, addedBy: string, input: unknown) {
  const parsed = recipientSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Check the form.", 422);
  const { value } = await whatsappConfig();
  const phone = normalisePhone(parsed.data.phone, value.defaultCountryCode);
  const [existing] = await platformQuery<RecipientRow[]>((query) => query(`SELECT * FROM whatsapp_recipients WHERE tenant_id = $1 AND phone = $2`, [tenantId, phone]));
  if (existing) throw new DomainError(`${phone} is already a recipient${existing.opted_out_at ? " (opted out; they must opt in again)" : ""}.`, 409);
  const [row] = await platformQuery<RecipientRow[]>((query) =>
    query(
      `INSERT INTO whatsapp_recipients (id, tenant_id, name, phone, types, outlet_id, consent_at, consent_by, consent_note) VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8) RETURNING *`,
      [`war-${randomUUID()}`, tenantId, parsed.data.name, phone, JSON.stringify([...new Set(parsed.data.types)]), parsed.data.outletId || null, addedBy, parsed.data.consentNote || null],
    ),
  );
  return row;
}

const recipientPatch = z.object({
  types: z.array(z.string().refine(isNotificationType)).max(TYPE_KEYS.length).optional(),
  outletId: z.string().trim().max(60).nullable().optional(),
  /** true: opt the person out now. false: opt back in, which needs fresh consent. */
  optedOut: z.boolean().optional(),
  consent: z.boolean().optional(),
});

export async function updateRecipient(tenantId: string, id: string, changedBy: string, input: unknown) {
  const patch = recipientPatch.parse(input);
  const [row] = await platformQuery<RecipientRow[]>((query) => query(`SELECT * FROM whatsapp_recipients WHERE id = $1 AND tenant_id = $2`, [id, tenantId]));
  if (!row) throw new DomainError("Recipient not found.", 404);
  if (patch.optedOut === false && row.opted_out_at && patch.consent !== true) throw new DomainError("Opting back in needs the person's fresh consent: tick the consent box.", 422);
  const [updated] = await platformQuery<RecipientRow[]>((query) =>
    query(
      `UPDATE whatsapp_recipients SET
         types = COALESCE($3, types), outlet_id = CASE WHEN $4 THEN $5 ELSE outlet_id END,
         opted_out_at = CASE WHEN $6::boolean IS TRUE THEN COALESCE(opted_out_at, now()) WHEN $6::boolean IS FALSE THEN NULL ELSE opted_out_at END,
         opt_out_source = CASE WHEN $6::boolean IS TRUE THEN COALESCE(opt_out_source, 'pharmacy') WHEN $6::boolean IS FALSE THEN NULL ELSE opt_out_source END,
         consent_at = CASE WHEN $6::boolean IS FALSE THEN now() ELSE consent_at END, consent_by = CASE WHEN $6::boolean IS FALSE THEN $7 ELSE consent_by END,
         updated_at = now()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId, patch.types ? JSON.stringify([...new Set(patch.types)]) : null, patch.outletId !== undefined, patch.outletId ?? null, patch.optedOut ?? null, changedBy],
    ),
  );
  return updated;
}

export async function removeRecipient(tenantId: string, id: string) {
  const rows = await platformQuery<Array<{ id: string }>>((query) => query(`DELETE FROM whatsapp_recipients WHERE id = $1 AND tenant_id = $2 RETURNING id`, [id, tenantId]));
  if (!rows.length) throw new DomainError("Recipient not found.", 404);
}

// ------------------------------------------------------------------ opt-out links

const unsubscribeKey = () => createHmac("sha256", AUTH_SECRET).update("whatsapp-unsubscribe").digest();

export function unsubscribeToken(recipientId: string) {
  return `${recipientId}.${createHmac("sha256", unsubscribeKey()).update(recipientId).digest("base64url")}`;
}

export function unsubscribeLink(recipientId: string) {
  return `${appUrl()}/whatsapp/unsubscribe?t=${encodeURIComponent(unsubscribeToken(recipientId))}`;
}

/** Opts a recipient out from the link in their messages. Returns the pharmacy name, or null for a bad link. */
export async function optOutByToken(token: string) {
  const [id, signature] = token.split(".");
  if (!id || !signature) return null;
  const expected = Buffer.from(unsubscribeToken(id).split(".")[1]);
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [row] = await platformQuery<Array<{ name: string }>>((query) =>
    query(
      `UPDATE whatsapp_recipients r SET opted_out_at = COALESCE(r.opted_out_at, now()), opt_out_source = COALESCE(r.opt_out_source, 'link'), updated_at = now()
       FROM tenants t WHERE r.id = $1 AND t.id = r.tenant_id RETURNING t.name`,
      [id],
    ),
  );
  return row ? row.name : null;
}

// ------------------------------------------------------------------ queueing

type QueueRequest = {
  tenantId: string;
  type: NotificationType;
  /** Identifies this notification; one message per recipient per key, ever. */
  dedupeKey: string;
  values: Record<string, string | number | null | undefined>;
  /** Only recipients for this outlet (or for all outlets). */
  outletId?: string | null;
};

export type QueueResult = { queued: number; skipped: number; reason: string | null };

/**
 * Queues one notification for every eligible recipient of a pharmacy. Never sends and never throws for
 * WhatsApp problems (callers are payments, alerts and jobs): the result and the log say what happened.
 */
export async function queueNotification(request: QueueRequest): Promise<QueueResult> {
  try {
    const { value, apiKey } = await whatsappConfig();
    if (!value.enabled || !apiKey) return { queued: 0, skipped: 0, reason: "WhatsApp is not enabled." };
    if (!value.types[request.type]) return { queued: 0, skipped: 0, reason: `${NOTIFICATION_TYPES[request.type].label} are switched off by Web365.` };
    const preferences = await tenantPreferences(request.tenantId);
    if (!preferences.types[request.type]) return { queued: 0, skipped: 0, reason: "Switched off by the pharmacy." };
    const recipients = (await listRecipients(request.tenantId)).filter(
      (row) => !row.opted_out_at && row.types.includes(request.type) && (!request.outletId || !row.outlet_id || row.outlet_id === request.outletId),
    );
    if (!recipients.length) return { queued: 0, skipped: 0, reason: "No consenting recipient for this notification." };

    const [tenant] = await platformQuery<Array<{ name: string }>>((query) => query(`SELECT name FROM tenants WHERE id = $1`, [request.tenantId]));
    const template = await approvedTemplate(request.type);
    let blocked: string | null = template ? null : templateProblem(await listTemplates(), request.type);
    if (!blocked && !secretsAvailable()) blocked = "Secret storage is not set up on this server (SETTINGS_ENCRYPTION_KEY).";
    if (!blocked && ALERT_TYPES.includes(request.type)) {
      const [count] = await platformQuery<Array<{ sent: number }>>((query) =>
        query(`SELECT count(*)::int AS sent FROM whatsapp_messages WHERE tenant_id = $1 AND category = ANY($2) AND status <> 'SKIPPED' AND created_at > now() - interval '24 hours'`, [request.tenantId, ALERT_TYPES]),
      );
      if ((count?.sent ?? 0) + recipients.length > value.alertCapPerDay) blocked = `Daily limit of ${value.alertCapPerDay} alert messages for this pharmacy reached (cost control).`;
    }

    let queued = 0;
    let skipped = 0;
    for (const recipient of recipients) {
      const values: Record<string, string> = {};
      for (const [key, raw] of Object.entries({ pharmacy: tenant?.name ?? "", ...request.values })) if (raw !== null && raw !== undefined && String(raw) !== "") values[key] = String(raw);
      values.recipient_name = recipient.name;
      values.unsubscribe_link = unsubscribeLink(recipient.id);
      const rows = await platformQuery<Array<{ id: string }>>((query) =>
        query(
          `INSERT INTO whatsapp_messages (id, tenant_id, recipient_id, recipient_phone, category, template_id, template_name, dedupe_key, values_ciphertext, status, failure_reason, next_attempt_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
          [
            `wam-${randomUUID()}`, request.tenantId, recipient.id, recipient.phone, request.type, template?.id ?? null, template?.name ?? null,
            `${request.dedupeKey}:${recipient.id}`, blocked ? null : encryptSecrets({ values: JSON.stringify(values) }), blocked ? "SKIPPED" : "QUEUED", blocked,
          ],
        ),
      );
      if (!rows.length) continue; // already queued earlier: never twice
      if (blocked) skipped += 1;
      else queued += 1;
    }
    if (queued) kickQueue();
    return { queued, skipped, reason: blocked };
  } catch (error) {
    console.error("[whatsapp] could not queue", error instanceof Error ? error.message : "error");
    return { queued: 0, skipped: 0, reason: "WhatsApp queue unavailable." };
  }
}

// ------------------------------------------------------------------ sending (background queue)

/**
 * Asks for the queue to run once the current response has been sent (Next.js after()), so payment and account
 * notices do not wait for the next scheduled job. The request itself never waits for WhatsApp. Outside a
 * request (scheduled jobs) this does nothing: the job runs the queue itself.
 */
function kickQueue() {
  try {
    after(() => outsideTransaction(() => processWhatsAppQueue(20)).then(() => undefined, (error) => console.error("[whatsapp] queue", error instanceof Error ? error.message : "error")));
  } catch {
    // not inside a request
  }
}

type MessageRow = { id: string; created_at: Date; tenant_id: string | null; recipient_id: string | null; recipient_phone: string; category: string; template_id: string | null; values_ciphertext: string | null; status: string; attempts: number; claimed_at: Date | null };

async function finish(id: string, fields: Record<string, unknown>) {
  const entries = Object.entries(fields);
  await platformQuery((query) =>
    query(`UPDATE whatsapp_messages SET ${entries.map(([key], index) => `${key} = $${index + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [id, ...entries.map(([, value]) => value)]),
  );
}

/** Sends one claimed message. Returns its final or next status. */
async function sendOne(row: MessageRow, config: Awaited<ReturnType<typeof whatsappConfig>>): Promise<string> {
  const { value, apiKey } = config;
  if (Date.now() - new Date(row.created_at).getTime() > EXPIRE_AFTER_HOURS * 3_600_000) {
    await finish(row.id, { status: "FAILED", failure_reason: `Not sent within ${EXPIRE_AFTER_HOURS} hours; dropped as out of date.`, values_ciphertext: null, claimed_at: null });
    return "FAILED";
  }
  if (!value.enabled || !apiKey) {
    await finish(row.id, { status: "QUEUED", claimed_at: null, next_attempt_at: new Date(Date.now() + 15 * 60_000), failure_reason: "Waiting: WhatsApp is not enabled." });
    return "QUEUED";
  }
  // The recipient may have opted out after the message was queued.
  if (row.recipient_id) {
    const [recipient] = await platformQuery<Array<{ opted_out_at: Date | null }>>((query) => query(`SELECT opted_out_at FROM whatsapp_recipients WHERE id = $1`, [row.recipient_id]));
    if (!recipient || recipient.opted_out_at) {
      await finish(row.id, { status: "SKIPPED", failure_reason: "Recipient opted out or was removed.", values_ciphertext: null, claimed_at: null });
      return "SKIPPED";
    }
  }
  const [template] = row.template_id ? await platformQuery<TemplateRow[]>((query) => query(`SELECT * FROM whatsapp_templates WHERE id = $1`, [row.template_id])) : [];
  if (!template || template.status !== "APPROVED" || !template.active) {
    const reason = template ? `Template "${template.name}" is no longer approved and active.` : "Template not found.";
    await finish(row.id, { status: "SKIPPED", failure_reason: reason, values_ciphertext: null, claimed_at: null });
    return "SKIPPED";
  }
  const values = row.values_ciphertext ? (JSON.parse(decryptSecrets(row.values_ciphertext).values ?? "{}") as Record<string, string>) : {};
  const missing = template.variables.filter((name) => !values[name]);
  if (missing.length) {
    await finish(row.id, { status: "FAILED", failure_reason: `Missing template variable(s): ${missing.join(", ")}.`, values_ciphertext: null, claimed_at: null });
    return "FAILED";
  }
  const mergeInfo = Object.fromEntries(template.variables.map((name) => [name, values[name]]));
  const attempts = row.attempts + 1;
  const result = await sendTemplate(
    { baseUrl: value.baseUrl, apiKey, agentId: value.agentId || undefined },
    { from: value.senderNumber, to: row.recipient_phone, templateKey: template.template_key, templateAlias: template.template_alias, mergeInfo, clientReference: row.id },
  );
  if (result.ok) {
    await finish(row.id, { status: "SENT", attempts, provider_message_id: result.messageId, provider_request_id: result.requestId, sent_at: new Date(), failure_reason: null, values_ciphertext: null, claimed_at: null, next_attempt_at: null });
    return "SENT";
  }
  if (result.templateRejected) {
    await platformQuery((query) => query(`UPDATE whatsapp_templates SET status = 'REJECTED', status_note = $2, updated_at = now(), updated_by = 'Zoho CPaaS' WHERE id = $1`, [template.id, result.reason.slice(0, 300)]));
  }
  if (result.authFailed) await recordIntegrationCheck("whatsapp", false, result.reason, null).catch(() => undefined);
  if (result.permanent || attempts >= MAX_ATTEMPTS) {
    await finish(row.id, { status: "FAILED", attempts, failure_reason: result.reason, values_ciphertext: null, claimed_at: null, next_attempt_at: null });
    return "FAILED";
  }
  await finish(row.id, { status: "QUEUED", attempts, failure_reason: result.reason, claimed_at: null, next_attempt_at: new Date(Date.now() + RETRY_DELAYS_MINUTES[attempts - 1] * 60_000) });
  return "QUEUED";
}

/** Rows stuck in SENDING (a crashed run): if Zoho has the message, record it; otherwise send again. */
async function recoverStale(config: Awaited<ReturnType<typeof whatsappConfig>>) {
  const stale = await platformQuery<Array<{ id: string }>>((query) =>
    query(`SELECT id FROM whatsapp_messages WHERE status = 'SENDING' AND claimed_at < now() - ($1 || ' minutes')::interval LIMIT 20`, [String(STALE_SENDING_MINUTES)]),
  );
  for (const { id } of stale) {
    if (!config.apiKey) break;
    const logs = await getLogs(zohoClient(config.value, config.apiKey), { client_reference: id, limit: 1 });
    if (!logs.ok) continue; // try again next run rather than risk a duplicate
    const found = logs.entries[0];
    if (found) await finish(id, { status: "SENT", provider_message_id: found.message_id, provider_request_id: found.request_id ?? null, sent_at: new Date(), values_ciphertext: null, claimed_at: null, failure_reason: null });
    else await finish(id, { status: "QUEUED", claimed_at: null, next_attempt_at: new Date() });
  }
}

/** Sends due messages (run by the platform jobs every few minutes). */
export async function processWhatsAppQueue(limit = 50) {
  const config = await whatsappConfig();
  await recoverStale(config);
  const claimed = await platformQuery<MessageRow[]>((query) =>
    query(
      `UPDATE whatsapp_messages SET status = 'SENDING', claimed_at = now(), updated_at = now()
       WHERE id IN (SELECT id FROM whatsapp_messages WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, created_at, tenant_id, recipient_id, recipient_phone, category, template_id, values_ciphertext, status, attempts, claimed_at`,
      [limit],
    ),
  );
  const outcome: Record<string, number> = {};
  for (const row of claimed) {
    const status = await sendOne(row, config).catch(async (error) => {
      console.error("[whatsapp] send failed", error instanceof Error ? error.message : "error");
      await finish(row.id, { status: "QUEUED", claimed_at: null, next_attempt_at: new Date(Date.now() + 5 * 60_000), failure_reason: "Internal error; will retry." }).catch(() => undefined);
      return "QUEUED";
    });
    outcome[status] = (outcome[status] ?? 0) + 1;
  }
  return { due: claimed.length, ...outcome };
}

// ------------------------------------------------------------------ renewal reminders (platform job)

/** Queues a reminder 3 days before a paid period ends (once per period). */
export async function queueRenewalReminders(now = new Date()) {
  const due = await platformQuery<Array<{ tenant_id: string; plan: string; period_end: Date }>>((query) =>
    query(
      `SELECT s.tenant_id, p.name AS plan, s.current_period_end AS period_end FROM subscriptions s
       JOIN tenants t ON t.id = s.tenant_id JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'ACTIVE' AND NOT s.cancel_at_period_end AND t.status = 'ACTIVE' AND NOT t.is_demo
         AND s.current_period_end > $1 AND s.current_period_end <= $1::timestamptz + interval '3 days'`,
      [now],
    ),
  );
  let queued = 0;
  for (const row of due) {
    const end = new Date(row.period_end);
    const result = await queueNotification({
      tenantId: row.tenant_id,
      type: "renewal_reminder",
      dedupeKey: `renewal_reminder:${row.tenant_id}:${end.toISOString().slice(0, 10)}`,
      values: { plan: row.plan, renewal_date: end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), days_left: Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000)), link: `${appUrl()}/subscription` },
    });
    queued += result.queued;
  }
  return queued;
}

// ------------------------------------------------------------------ events from the rest of the platform

const EMAIL_TEMPLATE_TYPES: Record<string, NotificationType> = {
  payment_confirmation: "payment_confirmation",
  payment_failure: "payment_failure",
  account_suspended: "account_suspended",
  account_reactivated: "account_reactivated",
  system_announcement: "announcement",
};

/** Called next to the owner emails (billing, suspension, announcements): queues the WhatsApp version. */
export async function queueForOwnerEmail(tenantId: string, emailTemplate: string, values: Record<string, string | number | null | undefined>) {
  const type = EMAIL_TEMPLATE_TYPES[emailTemplate];
  if (!type) return null;
  // Same notice, same day: queued once. The same notice on another day (e.g. a second suspension) is new.
  const fingerprint = createHmac("sha256", "dedupe").update(`${new Date().toISOString().slice(0, 10)}:${JSON.stringify(values)}`).digest("hex").slice(0, 16);
  return queueNotification({
    tenantId,
    type,
    dedupeKey: `${type}:${tenantId}:${fingerprint}`,
    values: { ...values, support_contact: values.support_contact ?? "Web365 support", link: values.link ?? `${appUrl()}/` },
  });
}

// ------------------------------------------------------------------ checks and tests (Control Centre)

/** Checks the saved credentials with a read-only Zoho call. Never sends a message. The caller records the result. */
export async function testConnection() {
  const { value, apiKey } = await whatsappConfig();
  let ok = false;
  let detail: string;
  if (!apiKey) detail = "No agent API key is saved.";
  else {
    const logs = await getLogs(zohoClient(value, apiKey), { limit: 5 });
    if (!logs.ok) detail = logs.status === 401 ? `Zoho CPaaS rejected the API key (${logs.reason}).` : logs.reason;
    else {
      ok = true;
      const sample = logs.entries[0];
      const notes: string[] = [`Zoho CPaaS accepted the API key at ${value.baseUrl} (WhatsApp scope). No message was sent.`];
      if (sample) {
        if (value.agentId && sample.agent_id && sample.agent_id !== value.agentId) notes.push(`Recent messages were sent by agent ${sample.agent_id}, not the configured agent ${value.agentId}.`);
        else if (sample.agent_id) notes.push(`Sending agent: ${sample.agent_id}.`);
        if (value.wabaId && sample.waba_id && sample.waba_id !== value.wabaId) notes.push(`Recent messages used WABA ${sample.waba_id}, not ${value.wabaId}.`);
        if (value.senderNumber && sample.from && sample.from !== value.senderNumber) notes.push(`Recent messages were sent from ${sample.from}, not ${value.senderNumber}.`);
      } else notes.push("No messages yet, so the agent and sender number are confirmed by the first test message.");
      detail = notes.join(" ");
    }
  }
  return { ok, detail };
}

const testSchema = z.object({
  phone: z.string().trim().min(6).max(30),
  templateId: z.string().min(1).max(80),
  confirmed: z.literal(true, { message: "Confirm that the owner of this number agreed to receive a test message" }),
});

/** Sends one test message now to a number the admin typed and confirmed. Uses only approved templates. */
export async function sendTestMessage(actor: { id: string; name: string }, input: unknown) {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Check the form.", 422);
  const config = await whatsappConfig();
  if (!config.apiKey) throw new DomainError("Save the agent API key first.", 409);
  if (!config.value.senderNumber) throw new DomainError("Save the WhatsApp sender number first.", 409);
  if (!secretsAvailable()) throw new DomainError("Secret storage is not set up on this server (SETTINGS_ENCRYPTION_KEY).", 409);
  const phone = normalisePhone(parsed.data.phone, config.value.defaultCountryCode);
  const [template] = await platformQuery<TemplateRow[]>((query) => query(`SELECT * FROM whatsapp_templates WHERE id = $1`, [parsed.data.templateId]));
  if (!template) throw new DomainError("Template not found.", 404);
  if (template.status !== "APPROVED" || !template.active) throw new DomainError(`"${template.name}" is not approved and active, so it cannot be sent. Approve it in Zoho CPaaS first, then mark it Approved here.`, 409);
  const { sampleValues } = await import("./catalog");
  const values = sampleValues(template.notification_type as NotificationType);
  const id = `wam-${randomUUID()}`;
  await platformQuery((query) =>
    query(
      `INSERT INTO whatsapp_messages (id, recipient_phone, category, template_id, template_name, dedupe_key, values_ciphertext, status, created_by, claimed_at)
       VALUES ($1, $2, 'test', $3, $4, $5, $6, 'SENDING', $7, now())`,
      [id, phone, template.id, template.name, `test:${id}`, encryptSecrets({ values: JSON.stringify(values) }), actor.name],
    ),
  );
  const [row] = await platformQuery<MessageRow[]>((query) => query(`SELECT * FROM whatsapp_messages WHERE id = $1`, [id]));
  // A test is sent once: a temporary failure is reported, not retried in the background.
  const status = await sendOne({ ...row, attempts: MAX_ATTEMPTS - 1 }, { ...config, value: { ...config.value, enabled: true } });
  const [after] = await platformQuery<Array<{ status: string; failure_reason: string | null; provider_message_id: string | null }>>((query) => query(`SELECT status, failure_reason, provider_message_id FROM whatsapp_messages WHERE id = $1`, [id]));
  const ok = status === "SENT";
  await recordIntegrationCheck("whatsapp", ok, ok ? `Test message to ${phone} accepted by Zoho (message ${after.provider_message_id}).` : `Test message to ${phone} not sent: ${after.failure_reason}`, actor.id);
  return { ok, status: after.status, messageId: after.provider_message_id, detail: ok ? `Zoho CPaaS accepted the message (ID ${after.provider_message_id}). Delivery is confirmed by the webhook.` : after.failure_reason ?? "Not sent." };
}

// ------------------------------------------------------------------ delivery webhooks

/**
 * Applies one verified webhook event. Status only moves forward (sent → delivered → read); "undelivered"
 * never overrides a delivery already confirmed. Unknown references are ignored.
 */
export async function applyWebhookEvent(event: WebhookEvent) {
  const [row] = await platformQuery<Array<{ id: string; status: string; delivered_at: Date | null }>>((query) =>
    query(
      `SELECT id, status, delivered_at FROM whatsapp_messages WHERE ($1::text IS NOT NULL AND provider_message_id = $1) OR ($2::text IS NOT NULL AND id = $2) LIMIT 1`,
      [event.messageReference, event.clientReference],
    ),
  );
  if (!row) return "unknown message";
  const at = event.time && !Number.isNaN(Date.parse(event.time)) ? new Date(event.time) : new Date();
  if (event.kind === "undelivered") {
    if (row.status === "DELIVERED" || row.status === "READ") return "ignored (already delivered)";
    await finish(row.id, { status: "UNDELIVERED", failure_reason: event.reason ?? "Not delivered by WhatsApp.", values_ciphertext: null });
    return "undelivered";
  }
  if (event.kind === "delivered") {
    if (row.status === "READ") {
      if (!row.delivered_at) await finish(row.id, { delivered_at: at });
      return "ignored (already read)";
    }
    await finish(row.id, { status: "DELIVERED", delivered_at: row.delivered_at ?? at, failure_reason: null });
    return "delivered";
  }
  await platformQuery((query) =>
    query(`UPDATE whatsapp_messages SET status = 'READ', delivered_at = COALESCE(delivered_at, $2), read_at = COALESCE(read_at, $2), failure_reason = NULL, updated_at = now() WHERE id = $1`, [row.id, at]),
  );
  return "read";
}

// ------------------------------------------------------------------ message history

const filtersSchema = z.object({
  tenant: z.string().max(80).optional(),
  recipient: z.string().max(40).optional(),
  status: z.enum(["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "UNDELIVERED", "FAILED", "SKIPPED"]).optional(),
  category: z.string().max(40).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Message history. With tenantScope, strictly that pharmacy's messages (the filter's tenant is ignored). */
export async function listMessages(filters: Record<string, string | undefined>, tenantScope: string | null, limit = 200) {
  const clean = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  const parsed = filtersSchema.safeParse(clean);
  const f = parsed.success ? parsed.data : {};
  const tenant = tenantScope ?? f.tenant ?? null;
  return platformQuery<Array<Record<string, unknown>>>((query) =>
    query(
      `SELECT m.id, m.created_at, m.tenant_id, t.name AS pharmacy, m.recipient_phone, r.name AS recipient_name, m.category, m.template_name, m.provider_message_id,
              m.id AS client_reference, m.sent_at, m.status, m.delivered_at, m.read_at, m.failure_reason, m.attempts
       FROM whatsapp_messages m LEFT JOIN tenants t ON t.id = m.tenant_id LEFT JOIN whatsapp_recipients r ON r.id = m.recipient_id
       WHERE ($1::text IS NULL OR m.tenant_id = $1) AND ($2::boolean IS FALSE OR m.tenant_id IS NOT NULL)
         AND ($3::text IS NULL OR m.recipient_phone LIKE '%' || $3 || '%') AND ($4::text IS NULL OR m.status = $4) AND ($5::text IS NULL OR m.category = $5)
         AND ($6::date IS NULL OR m.created_at >= $6::date) AND ($7::date IS NULL OR m.created_at < $7::date + 1)
       ORDER BY m.created_at DESC LIMIT $8`,
      [tenant, tenantScope !== null, f.recipient?.replace(/[^\d+]/g, "") || null, f.status ?? null, f.category ?? null, f.from ?? null, f.to ?? null, limit],
    ),
  );
}
