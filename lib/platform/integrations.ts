// Status of every outside service the platform uses, from its real configuration and real checks only: a
// service is shown as connected only after a successful check, never because a setting exists.
import { platformQuery } from "@/lib/db/database";
import { paystackConfig } from "@/lib/billing/config";
import { emailTransport } from "@/lib/notify/email";
import { pushConfigured } from "@/lib/notify/push";
import { lastChecks, readPlatformSetting } from "@/lib/platform/settings";

export type Integration = {
  name: string;
  purpose: string;
  status: "connected" | "configured" | "not_configured" | "error" | "off";
  detail: string;
  settingsHref: string | null;
  lastCheck: string | null;
};

const time = (value: string | Date | null | undefined) => (value ? new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC" : null);

export async function integrations(): Promise<Integration[]> {
  const [paystack, paystackChecks, transport, emailChecks, switches] = await Promise.all([
    paystackConfig(), lastChecks("paystack"), emailTransport(), lastChecks("email"), readPlatformSetting("notifications.global").catch(() => null),
  ]);
  const [webhook] = await platformQuery<Array<{ last: Date | null; failed: string }>>((query) =>
    query(`SELECT max(received_at) AS last, count(*) FILTER (WHERE processed_at IS NULL AND received_at > now() - interval '1 day') AS failed FROM webhook_events WHERE provider = 'paystack'`),
  );
  const [cron] = await platformQuery<Array<{ last: Date | null }>>((query) => query(`SELECT max(started_at) AS last FROM platform_job_runs WHERE trigger IN ('cron', 'worker-cron')`));
  const checked = (checks: Awaited<ReturnType<typeof lastChecks>>) => (checks.last ? (checks.last.ok ? "connected" : "error") : "configured");

  return [
    {
      name: "Paystack", purpose: "Subscription payments and refunds", settingsHref: "/platform/settings/payments", lastCheck: time(paystackChecks.last?.at),
      status: paystack.source === "none" ? "not_configured" : checked(paystackChecks),
      detail: paystack.source === "none" ? "No keys: pharmacies cannot pay online." : `${paystack.mode === "live" ? "Live" : "Test"} mode (keys from ${paystack.source}). ${paystackChecks.last ? paystackChecks.last.detail : "Run Test connection to confirm the keys work."}`,
    },
    {
      name: "Paystack webhooks", purpose: "Payment and refund confirmations from Paystack", settingsHref: "/platform/settings/payments", lastCheck: time(webhook?.last),
      status: !webhook?.last ? "not_configured" : Number(webhook.failed) > 0 ? "error" : "connected",
      detail: !webhook?.last ? "None received yet. Set the webhook URL in the Paystack dashboard." : `Last received ${time(webhook.last)}; ${webhook.failed} not processed in the last 24 hours.`,
    },
    {
      name: "Email", purpose: "Account, billing, alert and support emails", settingsHref: "/platform/settings/email", lastCheck: time(emailChecks.last?.at),
      status: transport.kind === "off" ? (transport.reason.includes("turned off") ? "off" : "not_configured") : transport.kind === "json" ? "configured" : checked(emailChecks),
      detail: transport.kind === "off" ? transport.reason : transport.kind === "json" ? "Test outbox only: nothing leaves the server." : transport.kind === "environment" ? "SMTP from the server environment." : `${transport.value.provider} as ${transport.value.senderEmail}. ${emailChecks.last ? emailChecks.last.detail : "Run Test connection to confirm."}`,
    },
    {
      name: "Push notifications (Firebase)", purpose: "Alerts on the Android app", settingsHref: "/platform/settings/general", lastCheck: null,
      status: !pushConfigured() ? "not_configured" : switches && !switches.value.pushNotifications ? "off" : "configured",
      detail: !pushConfigured() ? "Set FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY on the server to send push notifications." : switches && !switches.value.pushNotifications ? "Configured, but switched off in Notifications." : "Credentials set on the server (delivery is confirmed per message in each pharmacy's alert log).",
    },
    {
      name: "Document storage", purpose: "Regulatory documents and logos", settingsHref: null, lastCheck: null,
      status: "configured",
      detail: process.env.DOCUMENT_STORAGE === "postgres" ? "Stored in the database (DOCUMENT_STORAGE=postgres)." : "Cloudflare R2 bucket when running on Workers; otherwise the database.",
    },
    {
      name: "Scheduled jobs (cron)", purpose: "Alert scans, summaries and the email queue", settingsHref: "/platform/settings/system", lastCheck: time(cron?.last),
      status: !process.env.CRON_SECRET && process.env.ALERT_SCHEDULER === "off" ? "not_configured" : cron?.last ? (Date.now() - new Date(cron.last).getTime() < 26 * 3_600_000 ? "connected" : "error") : "configured",
      detail: cron?.last ? `Last external run ${time(cron.last)}.` : process.env.ALERT_SCHEDULER === "off" ? "In-process scheduler off; waiting for the first external cron call (CRON_SECRET)." : "In-process scheduler (runs every minute on each server).",
    },
  ];
}
