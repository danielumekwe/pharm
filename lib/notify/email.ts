// Email delivery for the whole platform: one function, sendEmail(), for every email.
//
// Which transport: the Control Centre's "Email delivery" settings once they have been saved (ZeptoMail API,
// ZeptoMail SMTP relay or any SMTP server; "off" there stops all email). Before that, the server
// environment (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_FROM), or EMAIL_TRANSPORT=json in
// tests (messages built but not delivered).
//
// Every email is logged in email_deliveries. Platform emails (account, billing) that fail are retried with
// increasing delays; their content is kept for the retry only encrypted (it can hold one-time links).
// Pharmacy alert emails are logged without their subject (pharmacy business data); their retries are
// handled per pharmacy (lib/erp/alerts.ts). Secrets never appear in logs or error messages.
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

import { platformQuery } from "@/lib/db/database";
import { decryptSecrets, encryptSecrets, secretsAvailable } from "@/lib/platform/secrets";
import { readPlatformSetting, type SettingValue } from "@/lib/platform/settings";

export type DeliveryResult = { status: "SENT" | "SKIPPED" | "FAILED"; detail: string };
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};
export type EmailMeta = {
  /** pharmacy (default): pharmacy alert emails. Others are platform emails. */
  category?: "account" | "billing" | "platform" | "test" | "pharmacy";
  template?: string;
  tenantId?: string | null;
  /** Retry from the platform queue if delivery fails (platform emails only). */
  retryable?: boolean;
};

type EmailSettings = SettingValue<"email.delivery">;
type Transport =
  | { kind: "settings"; value: EmailSettings; secrets: Record<string, string> }
  | { kind: "environment" }
  | { kind: "json" }
  | { kind: "off"; reason: string };

const RETRY_DELAYS_MINUTES = [5, 30, 120, 720];
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

/** The transport in force right now (read fresh: settings can change on any server instance). */
export async function emailTransport(): Promise<Transport> {
  try {
    const setting = await readPlatformSetting("email.delivery");
    if (setting.updatedAt) {
      if (!setting.value.enabled) return { kind: "off", reason: "Email delivery is turned off in the Control Centre." };
      return { kind: "settings", value: setting.value, secrets: setting.secrets };
    }
  } catch (error) {
    console.error("[email] settings unavailable", error instanceof Error ? error.name : "error");
  }
  if (process.env.EMAIL_TRANSPORT === "json") return { kind: "json" };
  if (process.env.SMTP_HOST && process.env.ALERT_EMAIL_FROM) return { kind: "environment" };
  return { kind: "off", reason: "Email not configured (set it up in Control Centre → Email)." };
}

export async function emailConfigured() {
  return (await emailTransport()).kind !== "off";
}

function describe(transport: Transport) {
  if (transport.kind === "settings") return transport.value.provider;
  return transport.kind;
}

/** Removes any secret value from text that might be stored or shown (provider error messages). */
function redact(text: string, transport: Transport) {
  let clean = text;
  if (transport.kind === "settings") for (const secret of Object.values(transport.secrets)) if (secret) clean = clean.split(secret).join("•••");
  if (process.env.SMTP_PASS) clean = clean.split(process.env.SMTP_PASS).join("•••");
  return clean.slice(0, 500);
}

const zeptoToken = (secrets: Record<string, string>) => {
  const token = secrets.apiToken ?? "";
  return token.startsWith("Zoho-enczapikey") ? token : `Zoho-enczapikey ${token}`;
};
const zeptoBase = (value: EmailSettings) => (process.env.ZEPTOMAIL_BASE_URL || `https://api.zeptomail.${value.zeptoRegion}`).replace(/\/$/, "");

function smtpTransport(value: EmailSettings, secrets: Record<string, string>) {
  const zepto = value.provider === "zeptomail_smtp";
  return nodemailer.createTransport({
    host: value.host || (zepto ? `smtp.zeptomail.${value.zeptoRegion}` : ""),
    port: value.port,
    secure: value.encryption === "ssl",
    requireTLS: value.encryption === "starttls",
    ignoreTLS: value.encryption === "none",
    auth: zepto
      ? { user: value.username || "emailapikey", pass: secrets.password || (secrets.apiToken ?? "").replace(/^Zoho-enczapikey\s+/, "") }
      : value.username ? { user: value.username, pass: secrets.password ?? "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
}

/** Delivers one message with the given transport (no logging). */
async function deliver(transport: Transport, message: EmailMessage): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    if (transport.kind === "off") return { ok: false, error: transport.reason };
    if (transport.kind === "json") {
      const json = nodemailer.createTransport({ jsonTransport: true });
      const info = await json.sendMail({ from: process.env.ALERT_EMAIL_FROM ?? "alerts@pharmacy-erp.local", ...message });
      // Tests only: keep a copy of each message so a test can follow the links it contains.
      if (process.env.EMAIL_OUTBOX_DIR) {
        const { appendFile } = await import("node:fs/promises");
        await appendFile(`${process.env.EMAIL_OUTBOX_DIR}/outbox.jsonl`, `${JSON.stringify({ to: message.to, subject: message.subject, text: message.text, at: new Date().toISOString() })}\n`);
      }
      return { ok: true, id: `json:${info.messageId}` };
    }
    if (transport.kind === "environment") {
      const smtp = nodemailer.createTransport({
        host: process.env.SMTP_HOST!,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT ?? 587) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
      });
      const info = await smtp.sendMail({ from: process.env.ALERT_EMAIL_FROM!, ...message });
      return { ok: true, id: info.messageId };
    }
    const { value, secrets } = transport;
    if (value.provider === "zeptomail_api") {
      const response = await fetch(`${zeptoBase(value)}/v1.1/email`, {
        method: "POST",
        headers: { Authorization: zeptoToken(secrets), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          from: { address: value.senderEmail, name: value.senderName },
          to: [{ email_address: { address: message.to } }],
          ...(value.replyTo ? { reply_to: [{ address: value.replyTo }] } : {}),
          subject: message.subject,
          textbody: message.text,
          ...(message.html ? { htmlbody: message.html } : {}),
          ...(message.attachments?.length ? { attachments: message.attachments.map((file) => ({ name: file.filename, mime_type: file.contentType ?? "application/octet-stream", content: file.content.toString("base64") })) } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await response.json().catch(() => null)) as { request_id?: string; error?: { code?: string; message?: string; details?: Array<{ message?: string }> } } | null;
      if (!response.ok) return { ok: false, error: `ZeptoMail ${response.status}: ${body?.error?.details?.[0]?.message ?? body?.error?.message ?? "request refused"}` };
      return { ok: true, id: body?.request_id ?? "zeptomail" };
    }
    const info = await smtpTransport(value, secrets).sendMail({ from: { name: value.senderName, address: value.senderEmail }, replyTo: value.replyTo || undefined, ...message });
    return { ok: true, id: info.messageId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Delivery failed" };
  }
}

/** Sends one email and logs it. Never throws for delivery problems: the result says what happened. */
export async function sendEmail(message: EmailMessage, meta: EmailMeta = {}): Promise<DeliveryResult> {
  const switchedOff = await notificationSwitchedOff(meta.category ?? "pharmacy");
  const transport: Transport = switchedOff ? { kind: "off", reason: switchedOff } : await emailTransport();
  const category = meta.category ?? "pharmacy";
  const outcome = transport.kind === "off" ? null : await deliver(transport, message);
  const status: DeliveryResult["status"] = !outcome ? "SKIPPED" : outcome.ok ? "SENT" : "FAILED";
  const error = outcome && !outcome.ok ? redact(outcome.error, transport) : transport.kind === "off" ? transport.reason : null;
  const retry = status === "FAILED" && meta.retryable === true && category !== "pharmacy" && secretsAvailable();
  await platformQuery((query) =>
    query(
      `INSERT INTO email_deliveries (id, category, template, tenant_id, recipient, subject, status, provider, provider_message_id, attempts, next_attempt_at, last_error, sent_at, body_ciphertext)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        `mail-${randomUUID()}`, category, meta.template ?? null, meta.tenantId ?? null, message.to,
        category === "pharmacy" ? "Pharmacy email (subject not shown on the platform)" : message.subject.slice(0, 300),
        retry ? "RETRYING" : status, describe(transport), outcome?.ok ? outcome.id : null, outcome ? 1 : 0,
        retry ? new Date(Date.now() + RETRY_DELAYS_MINUTES[0] * 60_000) : null, error, outcome?.ok ? new Date() : null,
        retry ? encryptSecrets({ message: JSON.stringify({ to: message.to, subject: message.subject, text: message.text, html: message.html ?? null }) }) : null,
      ],
    ),
  ).catch((logError) => console.error("[email] could not log delivery", logError instanceof Error ? logError.message : "error"));

  if (status === "SENT") return { status, detail: `${describe(transport)}: ${outcome && outcome.ok ? outcome.id : ""}` };
  if (status === "SKIPPED") return { status, detail: error ?? "Skipped" };
  return { status, detail: error ?? "Delivery failed" };
}

/** Sends a logged platform email again now (from the queue or the Control Centre's retry button). */
export async function retryEmail(id: string): Promise<DeliveryResult> {
  const [row] = await platformQuery<Array<{ status: string; attempts: number; body_ciphertext: string | null }>>((query) => query(`SELECT status, attempts, body_ciphertext FROM email_deliveries WHERE id = $1`, [id]));
  if (!row) return { status: "FAILED", detail: "Unknown email." };
  if (row.status === "SENT") return { status: "SENT", detail: "Already sent." };
  if (!row.body_ciphertext) return { status: "FAILED", detail: "This email cannot be retried from the platform (its content is not kept)." };
  const message = JSON.parse(decryptSecrets(row.body_ciphertext).message) as EmailMessage;
  const transport = await emailTransport();
  const outcome = transport.kind === "off" ? { ok: false as const, error: transport.reason } : await deliver(transport, message);
  const attempts = row.attempts + 1;
  const giveUp = !outcome.ok && attempts >= MAX_ATTEMPTS;
  await platformQuery((query) =>
    query(
      `UPDATE email_deliveries SET status = $1, attempts = $2, next_attempt_at = $3, last_error = $4, sent_at = $5, provider = $6, provider_message_id = $7,
              body_ciphertext = CASE WHEN $1 IN ('SENT', 'FAILED') THEN NULL ELSE body_ciphertext END
       WHERE id = $8`,
      [
        outcome.ok ? "SENT" : giveUp ? "FAILED" : "RETRYING", attempts,
        outcome.ok || giveUp ? null : new Date(Date.now() + RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)] * 60_000),
        outcome.ok ? null : redact(outcome.error, transport), outcome.ok ? new Date() : null, describe(transport), outcome.ok ? outcome.id : null, id,
      ],
    ),
  );
  return outcome.ok ? { status: "SENT", detail: outcome.id } : { status: "FAILED", detail: redact(outcome.error, transport) };
}

/** Retries platform emails whose next attempt is due (run by the scheduled jobs). */
export async function processEmailQueue(limit = 50) {
  const due = await platformQuery<Array<{ id: string }>>((query) =>
    query(`SELECT id FROM email_deliveries WHERE status = 'RETRYING' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1`, [limit]),
  );
  let sent = 0;
  for (const { id } of due) if ((await retryEmail(id)).status === "SENT") sent += 1;
  return { due: due.length, sent };
}

/**
 * A real connection check that sends nothing. SMTP: the server accepts the login. ZeptoMail API: an empty
 * request is answered with a validation error (token accepted) rather than an authorisation error.
 */
export async function testEmailConnection(): Promise<{ ok: boolean; detail: string }> {
  const transport = await emailTransport();
  if (transport.kind === "off") return { ok: false, detail: transport.reason };
  if (transport.kind === "json") return { ok: true, detail: "Test mode: messages are built but not delivered." };
  if (transport.kind === "environment") return { ok: false, detail: "Using server environment settings; save Control Centre settings to test them here." };
  const { value, secrets } = transport;
  try {
    if (value.provider === "zeptomail_api") {
      if (!secrets.apiToken) return { ok: false, detail: "No ZeptoMail API token is saved." };
      const response = await fetch(`${zeptoBase(value)}/v1.1/email`, { method: "POST", headers: { Authorization: zeptoToken(secrets), "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
      if (response.status === 401 || response.status === 403) return { ok: false, detail: `ZeptoMail rejected the token (HTTP ${response.status}).` };
      if (response.status >= 500) return { ok: false, detail: `ZeptoMail is not responding properly (HTTP ${response.status}).` };
      return { ok: true, detail: `ZeptoMail accepted the token (${value.zeptoRegion} region). No email was sent; send a test email to check the sender address.` };
    }
    await smtpTransport(value, secrets).verify();
    return { ok: true, detail: `SMTP server accepted the connection and login (${value.provider === "zeptomail_smtp" ? "ZeptoMail relay" : value.host}:${value.port}, ${value.encryption}).` };
  } catch (error) {
    return { ok: false, detail: redact(error instanceof Error ? error.message : "Connection failed.", transport) };
  }
}

/** Control Centre → Notifications: alert and billing emails can be switched off platform-wide. */
async function notificationSwitchedOff(category: NonNullable<EmailMeta["category"]>) {
  if (category !== "pharmacy" && category !== "billing") return null;
  try {
    const { value } = await readPlatformSetting("notifications.global");
    if (category === "pharmacy" && !value.pharmacyAlertEmails) return "Alert emails are switched off by Web365.";
    if (category === "billing" && !value.billingEmails) return "Billing emails are switched off by Web365.";
  } catch {
    // settings unavailable: send as usual
  }
  return null;
}
