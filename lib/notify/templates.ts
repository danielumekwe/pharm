// Email templates: defaults here, edits by Web365 stored in email_templates (subject and plain-text body with
// {{variables}}). Every email is sent as text plus a simple branded HTML version made from the same text,
// with every value HTML-escaped.
import { randomUUID } from "node:crypto";

import { platformQuery } from "@/lib/db/database";
import { DomainError } from "@/lib/erp/services";
import { platformActorRef, recordPlatformAudit } from "@/lib/platform/audit";
import type { PlatformActor } from "@/lib/platform/session";
import { readPlatformSetting } from "@/lib/platform/settings";

type TemplateDefinition = { label: string; when: string; variables: string[]; required: string[]; subject: string; body: string };

const COMMON = ["app_name", "support_email"];

export const EMAIL_TEMPLATES = {
  welcome: {
    label: "Welcome (account created by Web365)",
    when: "Web365 creates a pharmacy for a customer: the owner chooses a password.",
    variables: ["name", "pharmacy", "link", "hours"],
    required: ["link"],
    subject: "Your {{pharmacy}} account is ready",
    body: "Hello {{name}},\n\nWeb365 has set up {{pharmacy}} on {{app_name}} with you as its Super Admin. Choose your password to sign in:\n{{link}}\n\nThe link works once and expires in {{hours}} hours.\n\nQuestions? Write to {{support_email}}.",
  },
  verify_email: {
    label: "Email verification",
    when: "A pharmacy registers, or someone asks for a new confirmation link.",
    variables: ["name", "pharmacy", "link", "hours"],
    required: ["link"],
    subject: "Confirm your email address",
    body: "Hello {{name}},\n\nPlease confirm this email address for your {{app_name}} account at {{pharmacy}}:\n{{link}}\n\nThe link works once and expires in {{hours}} hours. If you did not create this account, you can ignore this email.",
  },
  password_reset: {
    label: "Password reset",
    when: "Someone asks to reset their password.",
    variables: ["name", "link", "minutes"],
    required: ["link"],
    subject: "Reset your password",
    body: "Hello {{name}},\n\nWe received a request to reset your {{app_name}} password. Choose a new one here:\n{{link}}\n\nThe link works once and expires in {{minutes}} minutes. Resetting signs you out on every device.\nIf you did not ask for this, ignore this email; your password stays the same.",
  },
  join_pharmacy: {
    label: "Invitation to join another pharmacy",
    when: "A pharmacy adds someone who already has an account.",
    variables: ["name", "pharmacy", "role", "invited_by", "link", "days"],
    required: ["link"],
    subject: "{{invited_by}} invited you to {{pharmacy}}",
    body: "Hello {{name}},\n\n{{invited_by}} has added you to {{pharmacy}} as {{role}}. You keep your existing account and password.\nTo accept, open this link (it works once and expires in {{days}} days):\n{{link}}\n\nUntil you accept, you will not see this pharmacy when you sign in. If you were not expecting this, ignore the email.",
  },
  pharmacy_registered: {
    label: "New pharmacy registration (to Web365)",
    when: "A pharmacy registers itself. Sent to the Web365 notification address, if one is set.",
    variables: ["pharmacy", "owner_name", "owner_email", "plan", "state", "country"],
    required: ["pharmacy"],
    subject: "New pharmacy registered: {{pharmacy}}",
    body: "{{pharmacy}} has registered on {{app_name}}.\n\nOwner: {{owner_name}} <{{owner_email}}>\nPlan: {{plan}} (free trial)\nLocation: {{state}}, {{country}}",
  },
  trial_started: {
    label: "Trial started",
    when: "A pharmacy registers itself.",
    variables: ["name", "pharmacy", "plan", "trial_end", "link"],
    required: [],
    subject: "Your free trial of {{app_name}} has started",
    body: "Hello {{name}},\n\nWelcome to {{app_name}}. {{pharmacy}} is on a free trial of the {{plan}} plan until {{trial_end}}.\nChoose a plan any time from Subscription and billing:\n{{link}}\n\nQuestions? Write to {{support_email}}.",
  },
  trial_expiry_reminder: {
    label: "Trial expiry reminder",
    when: "A trial is about to end (sent by the subscription lifecycle job, phase 8).",
    variables: ["name", "pharmacy", "trial_end", "days_left", "link"],
    required: ["link"],
    subject: "Your trial ends in {{days_left}} days",
    body: "Hello {{name}},\n\nThe free trial for {{pharmacy}} ends on {{trial_end}}. To keep using {{app_name}} without interruption, choose a plan:\n{{link}}",
  },
  subscription_renewal: {
    label: "Subscription renewal reminder",
    when: "A paid period is about to end (sent by the subscription lifecycle job, phase 8).",
    variables: ["name", "pharmacy", "plan", "period_end", "link"],
    required: ["link"],
    subject: "Your {{plan}} subscription renews on {{period_end}}",
    body: "Hello {{name}},\n\nThe {{plan}} subscription for {{pharmacy}} runs until {{period_end}}. Renew or change it here:\n{{link}}",
  },
  payment_confirmation: {
    label: "Payment confirmation",
    when: "A subscription payment is confirmed by the payment provider.",
    variables: ["name", "pharmacy", "plan", "amount", "period_end", "invoice_number", "link"],
    required: [],
    subject: "Payment received: {{amount}}",
    body: "Hello {{name}},\n\nThank you. We received {{amount}} for {{pharmacy}}. The {{plan}} plan is active until {{period_end}}.\nInvoice {{invoice_number}} is in Subscription and billing:\n{{link}}",
  },
  payment_failure: {
    label: "Payment failure",
    when: "A subscription payment fails or is not completed.",
    variables: ["name", "pharmacy", "amount", "reason", "link"],
    required: [],
    subject: "Your payment of {{amount}} did not go through",
    body: "Hello {{name}},\n\nThe payment of {{amount}} for {{pharmacy}} did not go through ({{reason}}). Nothing was charged.\nYou can try again here:\n{{link}}",
  },
  account_suspended: {
    label: "Account suspension",
    when: "Web365 suspends a pharmacy.",
    variables: ["name", "pharmacy", "reason"],
    required: [],
    subject: "{{pharmacy}} has been suspended",
    body: "Hello {{name}},\n\n{{pharmacy}} has been suspended on {{app_name}}: {{reason}}.\nYour data is kept. To restore access, contact {{support_email}}.",
  },
  account_reactivated: {
    label: "Account reactivation",
    when: "Web365 reactivates a suspended pharmacy.",
    variables: ["name", "pharmacy", "link"],
    required: [],
    subject: "{{pharmacy}} is active again",
    body: "Hello {{name}},\n\n{{pharmacy}} is active again on {{app_name}}. Sign in here:\n{{link}}",
  },
  system_announcement: {
    label: "System announcement",
    when: "Web365 sends an announcement (phase 7F).",
    variables: ["name", "title", "message"],
    required: ["message"],
    subject: "{{title}}",
    body: "Hello {{name}},\n\n{{message}}\n\n— The {{app_name}} team",
  },
} satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof EMAIL_TEMPLATES;
export const isTemplateKey = (key: string): key is TemplateKey => key in EMAIL_TEMPLATES;

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function stored(key: TemplateKey) {
  const [row] = await platformQuery<Array<{ subject: string; body: string; updated_at: Date; updated_by: string | null }>>((query) =>
    query(`SELECT subject, body, updated_at, updated_by FROM email_templates WHERE key = $1`, [key]),
  );
  return row ?? null;
}

export async function listTemplates() {
  const rows = await platformQuery<Array<{ key: string; updated_at: Date }>>((query) => query(`SELECT key, updated_at FROM email_templates`));
  return (Object.keys(EMAIL_TEMPLATES) as TemplateKey[]).map((key) => {
    const edited = rows.find((row) => row.key === key);
    return { key, label: EMAIL_TEMPLATES[key].label, when: EMAIL_TEMPLATES[key].when, customised: Boolean(edited), updatedAt: edited ? new Date(edited.updated_at).toISOString() : null };
  });
}

export async function getTemplate(key: TemplateKey) {
  const definition = EMAIL_TEMPLATES[key];
  const row = await stored(key);
  return { key, ...definition, variables: [...COMMON, ...definition.variables], subject: row?.subject ?? definition.subject, body: row?.body ?? definition.body, customised: Boolean(row), defaultSubject: definition.subject, defaultBody: definition.body };
}

function check(key: TemplateKey, subject: string, body: string) {
  const definition = EMAIL_TEMPLATES[key];
  const allowed = new Set([...COMMON, ...definition.variables]);
  const used = new Set([...`${subject}\n${body}`.matchAll(PLACEHOLDER)].map((match) => match[1]));
  const unknown = [...used].filter((name) => !allowed.has(name));
  if (unknown.length) throw new DomainError(`Unknown variable${unknown.length > 1 ? "s" : ""}: ${unknown.map((name) => `{{${name}}}`).join(", ")}. Available: ${[...allowed].map((name) => `{{${name}}}`).join(", ")}.`, 422);
  const missing = definition.required.filter((name) => !used.has(name));
  if (missing.length) throw new DomainError(`This email must contain ${missing.map((name) => `{{${name}}}`).join(", ")}.`, 422);
  if (!subject.trim() || subject.length > 200) throw new DomainError("The subject must be 1 to 200 characters.", 422);
  if (!body.trim() || body.length > 10_000) throw new DomainError("The body must be 1 to 10,000 characters.", 422);
}

export async function saveTemplate(actor: PlatformActor, key: TemplateKey, input: { subject: string; body: string }) {
  const subject = input.subject.trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  check(key, subject, body);
  const before = await getTemplate(key);
  const changes = [subject !== before.subject ? `subject: ${JSON.stringify(before.subject)} → ${JSON.stringify(subject)}` : null, body !== before.body ? "body changed" : null].filter((entry): entry is string => Boolean(entry));
  if (!changes.length) return getTemplate(key);
  await platformQuery(async (query) => {
    await query(`INSERT INTO email_templates (key, subject, body, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4) ON CONFLICT (key) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now(), updated_by = EXCLUDED.updated_by`, [key, subject, body, actor.id]);
    await query(`INSERT INTO platform_settings_history (id, key, changed_by, changed_by_name, changes) VALUES ($1, $2, $3, $4, $5)`, [`set-${randomUUID()}`, `email.template.${key}`, actor.id, actor.name, JSON.stringify(changes)]);
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "email.template-update", targetType: "EmailTemplate", targetId: key, summary: `Email template "${EMAIL_TEMPLATES[key].label}" changed: ${changes.join("; ")}` });
  return getTemplate(key);
}

export async function resetTemplate(actor: PlatformActor, key: TemplateKey) {
  await platformQuery(async (query) => {
    await query(`DELETE FROM email_templates WHERE key = $1`, [key]);
    await query(`INSERT INTO platform_settings_history (id, key, changed_by, changed_by_name, changes) VALUES ($1, $2, $3, $4, $5)`, [`set-${randomUUID()}`, `email.template.${key}`, actor.id, actor.name, JSON.stringify(["reset to the default"])]);
  });
  await recordPlatformAudit(platformActorRef(actor), { action: "email.template-reset", targetType: "EmailTemplate", targetId: key, summary: `Email template "${EMAIL_TEMPLATES[key].label}" reset to the default` });
  return getTemplate(key);
}

export async function templateHistory(key: TemplateKey) {
  const rows = await platformQuery<Array<{ changed_at: Date; changed_by_name: string; changes: unknown }>>((query) =>
    query(`SELECT changed_at, changed_by_name, changes FROM platform_settings_history WHERE key = $1 ORDER BY changed_at DESC LIMIT 20`, [`email.template.${key}`]),
  );
  return rows.map((row) => ({ at: new Date(row.changed_at).toISOString(), by: row.changed_by_name, changes: row.changes as string[] }));
}

function fill(text: string, values: Record<string, string>) {
  return text.replace(PLACEHOLDER, (_, name: string) => values[name] ?? "");
}

function htmlFrom(text: string, values: Record<string, string>) {
  // Everything is escaped (template text as well as values), then only plain http(s) links become tags.
  const body = escapeHtml(fill(text, values))
    .replace(/https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<])+/g, (url) => `<a href="${url}" style="color:#15803d">${url}</a>`)
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px">${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f2f6f3;font-family:Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:16px;padding:28px 28px 16px">
<p style="margin:0 0 18px;font-size:18px;font-weight:bold;color:#15803d">${escapeHtml(values.app_name)}</p>${body}
<p style="margin:18px 0 0;font-size:12px;color:#6b7280">${escapeHtml(values.app_name)} by Web365 Nigeria${values.support_email ? ` · ${escapeHtml(values.support_email)}` : ""}</p>
</div></body></html>`;
}

/** The finished email for a template: subject, text and HTML, with the common values filled in. */
export async function renderEmail(key: TemplateKey, values: Record<string, string | number | null | undefined>) {
  const template = await getTemplate(key);
  let supportEmail = "";
  try {
    const email = await readPlatformSetting("email.delivery");
    supportEmail = email.value.replyTo || email.value.senderEmail;
  } catch {
    // no settings yet
  }
  const all: Record<string, string> = { app_name: "Pharmacy ERP", support_email: supportEmail };
  for (const [name, value] of Object.entries(values)) all[name] = value === null || value === undefined ? "" : String(value);
  return { subject: fill(template.subject, all).replace(/\s+/g, " ").trim(), text: fill(template.body, all), html: htmlFrom(template.body, all) };
}

const SAMPLE: Record<string, string> = {
  name: "Ngozi Okafor", pharmacy: "Sunrise Pharmacy", link: "https://example.com/link", hours: "48", minutes: "60", days: "7", role: "Cashier",
  invited_by: "Tunde Bello", owner_name: "Ngozi Okafor", owner_email: "ngozi@example.com", plan: "Professional", state: "Lagos", country: "Nigeria",
  trial_end: "21 November 2026", days_left: "3", period_end: "8 December 2026", amount: "NGN 30,000.00", invoice_number: "W365-2026-000001",
  reason: "Card declined", title: "Scheduled maintenance", message: "The platform will be unavailable on Sunday from 01:00 to 02:00.",
};

/** Checks and renders unsaved template text with sample values. */
export async function previewTemplate(key: TemplateKey, input: { subject: string; body: string }, variables: readonly string[]) {
  check(key, input.subject.trim(), input.body.trim());
  const values: Record<string, string> = { app_name: "Pharmacy ERP", support_email: "support@example.com" };
  for (const name of variables) values[name] = SAMPLE[name] ?? name;
  return { subject: fill(input.subject, values), text: fill(input.body, values), html: htmlFrom(input.body, values) };
}
