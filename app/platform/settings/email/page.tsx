import Link from "next/link";

import { PlatformShell } from "@/components/platform/platform-shell";
import { platformQuery } from "@/lib/db/database";
import { emailTransport } from "@/lib/notify/email";
import { requirePlatformPage } from "@/lib/platform/pages";
import { secretsAvailable } from "@/lib/platform/secrets";
import { describePlatformSetting, lastChecks } from "@/lib/platform/settings";

import { EmailDeliveries, EmailSettingsForm, TestEmail } from "./email-form";

export const metadata = { title: "Email · Web365 platform" };

const PROVIDERS = { zeptomail_api: "ZeptoMail (API)", zeptomail_smtp: "ZeptoMail (SMTP)", smtp: "SMTP server" } as const;

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requirePlatformPage("settings.manage");
  const { status } = await searchParams;
  const filter = ["SENT", "FAILED", "RETRYING", "SKIPPED"].includes(status ?? "") ? status! : null;
  const [setting, checks, transport, stats, deliveries] = await Promise.all([
    describePlatformSetting("email.delivery"),
    lastChecks("email"),
    emailTransport(),
    platformQuery<Array<{ status: string; count: number }>>((query) =>
      query(`SELECT status, count(*)::int AS count FROM email_deliveries WHERE created_at > now() - interval '24 hours' GROUP BY status`),
    ),
    platformQuery<Array<{ id: string; created_at: Date; category: string; template: string | null; pharmacy: string | null; recipient: string; subject: string; status: string; provider: string | null; attempts: number; next_attempt_at: Date | null; last_error: string | null; retryable: boolean }>>((query) =>
      query(
        `SELECT e.id, e.created_at, e.category, e.template, t.name AS pharmacy, e.recipient, e.subject, e.status, e.provider, e.attempts, e.next_attempt_at, e.last_error, (e.body_ciphertext IS NOT NULL) AS retryable
         FROM email_deliveries e LEFT JOIN tenants t ON t.id = e.tenant_id WHERE ($1::text IS NULL OR e.status = $1) ORDER BY e.created_at DESC LIMIT 100`,
        [filter],
      ),
    ),
  ]);
  const count = (name: string) => stats.find((row) => row.status === name)?.count ?? 0;
  const time = (value: Date | string | null) => (value ? new Date(value).toISOString().replace("T", " ").slice(0, 16) : "—");
  const inUse =
    transport.kind === "settings" ? `${PROVIDERS[transport.value.provider]}, sending as ${transport.value.senderName} <${transport.value.senderEmail}>.`
    : transport.kind === "environment" ? "SMTP from the server environment (SMTP_HOST). Save settings here to take over."
    : transport.kind === "json" ? "Test outbox (EMAIL_TRANSPORT=json): nothing leaves the server."
    : `Off: ${transport.reason}`;
  return (
    <PlatformShell actor={actor}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Email</h1>
          <p className="text-sm text-slate-600">How the platform sends account, billing and pharmacy alert emails.</p>
        </div>
        <Link href="/platform/settings/email/templates" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Email templates</Link>
      </div>
      {!secretsAvailable() ? <p role="alert" className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">Secret storage is not set up on this server (SETTINGS_ENCRYPTION_KEY). Credentials cannot be saved until it is.</p> : null}

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <EmailSettingsForm setting={JSON.parse(JSON.stringify(setting))} />
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" data-email-status>
            <h2 className="font-semibold">In use now</h2>
            <p className="mt-1">{inUse}</p>
            <p className="mt-2 text-slate-600">Last check: {checks.last ? `${checks.last.ok ? "succeeded" : "failed"} at ${time(checks.last.at)} UTC — ${checks.last.detail}` : "never run"}</p>
            <p className="text-slate-600">Last success: {checks.lastSuccessAt ? `${time(checks.lastSuccessAt)} UTC` : "—"}</p>
            {checks.lastError ? <p className="text-rose-700">Last error: {checks.lastError.detail} ({time(checks.lastError.at)} UTC)</p> : null}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" data-email-stats>
            <h2 className="font-semibold">Last 24 hours</h2>
            <p className="mt-1">{count("SENT")} sent · <span className={count("FAILED") ? "text-rose-700" : ""}>{count("FAILED")} failed</span> · {count("RETRYING")} waiting to retry · {count("SKIPPED")} not sent</p>
            <p className="mt-2 text-xs text-slate-500">Failed platform emails are retried after 5 minutes, 30 minutes, 2 hours and 12 hours.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5"><TestEmail defaultTo={actor.email} /></div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Delivery log</h2>
          <nav className="flex gap-1 text-sm">
            {[["All", null], ["Failed", "FAILED"], ["Waiting to retry", "RETRYING"], ["Sent", "SENT"], ["Not sent", "SKIPPED"]].map(([label, value]) => (
              <Link key={label} href={value ? `?status=${value}` : "?"} className={`rounded-md px-2 py-1 ${filter === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>
            ))}
          </nav>
        </div>
        <EmailDeliveries rows={JSON.parse(JSON.stringify(deliveries))} />
        <p className="mt-2 text-xs text-slate-500">Message bodies are not shown. Pharmacy alert emails are logged without their subject.</p>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Change history</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm" data-settings-history>
          {setting.history.length === 0 ? <li className="py-2 text-slate-500">No changes yet.</li> : setting.history.map((entry, index) => (
            <li key={index} className="py-2"><span className="text-slate-500">{time(entry.at)} UTC · {entry.by}</span><span className="block">{entry.changes.join("; ")}</span></li>
          ))}
        </ul>
      </section>
    </PlatformShell>
  );
}
