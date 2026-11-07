// Email delivery via SMTP. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and ALERT_EMAIL_FROM.

import nodemailer from "nodemailer";

export type DeliveryResult = { status: "SENT" | "SKIPPED" | "FAILED"; detail: string };

/**
 * EMAIL_TRANSPORT=json uses nodemailer's built-in JSON transport: messages are fully built but not
 * delivered. For automated tests and staging only; real delivery needs SMTP settings.
 */
function jsonTransport() {
  return process.env.EMAIL_TRANSPORT === "json";
}

export function emailConfigured() {
  return jsonTransport() || Boolean(process.env.SMTP_HOST && process.env.ALERT_EMAIL_FROM);
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}): Promise<DeliveryResult> {
  if (!emailConfigured()) return { status: "SKIPPED", detail: "Email not configured (set SMTP_HOST and ALERT_EMAIL_FROM)" };
  try {
    if (jsonTransport()) {
      const json = nodemailer.createTransport({ jsonTransport: true });
      const info = await json.sendMail({ from: process.env.ALERT_EMAIL_FROM ?? "alerts@pharmacy-erp.local", to: input.to, subject: input.subject, text: input.text, html: input.html, attachments: input.attachments });
      // Tests only: keep a copy of each message so a test can follow the links it contains.
      if (process.env.EMAIL_OUTBOX_DIR) {
        const { appendFile } = await import("node:fs/promises");
        await appendFile(`${process.env.EMAIL_OUTBOX_DIR}/outbox.jsonl`, `${JSON.stringify({ to: input.to, subject: input.subject, text: input.text, at: new Date().toISOString() })}\n`);
      }
      return { status: "SENT", detail: `JSON transport (test mode, not delivered) · ${info.messageId}` };
    }
    transporter ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    });
    const info = await transporter.sendMail({ from: process.env.ALERT_EMAIL_FROM!, to: input.to, subject: input.subject, text: input.text, html: input.html, attachments: input.attachments });
    return { status: "SENT", detail: `Message ${info.messageId}` };
  } catch (error) {
    return { status: "FAILED", detail: error instanceof Error ? error.message : "SMTP error" };
  }
}
