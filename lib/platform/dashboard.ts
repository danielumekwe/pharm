// Control Centre dashboard: real figures from the database and real checks only. A health item that has
// never been checked says so; nothing is assumed to be "connected".
import { platformQuery } from "@/lib/db/database";
import { paystackConfig } from "@/lib/billing/config";
import { emailConfigured } from "@/lib/notify/email";
import { lastChecks } from "@/lib/platform/settings";

type Count = string | number | null;
const n = (value: Count) => Number(value ?? 0);

export type Health = { name: string; status: "ok" | "warning" | "error" | "unknown"; detail: string; checkedAt: string | null };

export async function platformDashboard() {
  const started = Date.now();
  const data = await platformQuery(async (query) => {
    const [tenants] = await query<Record<string, Count>>(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE t.is_demo) AS demo,
             count(*) FILTER (WHERE t.status = 'ACTIVE' AND s.status = 'ACTIVE' AND (s.current_period_end IS NULL OR s.current_period_end > now())) AS active,
             count(*) FILTER (WHERE t.status = 'ACTIVE' AND s.status = 'TRIAL' AND s.trial_ends_at > now()) AS trial,
             count(*) FILTER (WHERE t.status = 'SUSPENDED' OR s.status = 'SUSPENDED') AS suspended,
             count(*) FILTER (WHERE t.status <> 'SUSPENDED' AND (s.status IN ('EXPIRED', 'CANCELLED')
                 OR (s.status = 'TRIAL' AND s.trial_ends_at <= now()) OR (s.status = 'ACTIVE' AND s.current_period_end <= now()))) AS expired,
             count(*) FILTER (WHERE s.status IN ('PAST_DUE', 'GRACE')) AS past_due,
             count(*) FILTER (WHERE NOT t.is_demo AND t.created_at > now() - interval '30 days') AS new_30,
             count(*) FILTER (WHERE NOT t.is_demo AND t.created_at > now() - interval '7 days') AS new_7
      FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id`);
    // Recurring revenue from paying subscriptions in a current paid period, at their plan's current price.
    const recurring = await query<{ currency: string; mrr: Count; subscriptions: Count; unpriced: Count }>(`
      SELECT p.currency,
             sum(CASE WHEN s.billing_cycle = 'MONTHLY' THEN p.monthly_price ELSE p.annual_price / 12 END) AS mrr,
             count(*) AS subscriptions,
             count(*) FILTER (WHERE (s.billing_cycle = 'MONTHLY' AND p.monthly_price IS NULL) OR (s.billing_cycle = 'ANNUAL' AND p.annual_price IS NULL)) AS unpriced
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id
      WHERE NOT t.is_demo AND t.status = 'ACTIVE' AND s.status = 'ACTIVE' AND s.current_period_end > now()
      GROUP BY p.currency ORDER BY p.currency`);
    const payments = await query<{ status: string; purpose: string; count: Count; amount: Count; currency: string }>(`
      SELECT status, purpose, currency, count(*) AS count, sum(amount) AS amount FROM billing_payments
      WHERE created_at > now() - interval '30 days' GROUP BY status, purpose, currency`);
    const plans = await query<{ name: string; count: Count }>(`
      SELECT p.name, count(s.id) FILTER (WHERE NOT t.is_demo) AS count
      FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id LEFT JOIN tenants t ON t.id = s.tenant_id
      GROUP BY p.name, p.sort_order ORDER BY p.sort_order`);
    const [database] = await query<{ size: Count; version: string }>(`SELECT pg_database_size(current_database()) AS size, current_setting('server_version') AS version`);
    const [webhooks] = await query<{ last_at: Date | null; day: Count; errors: Count }>(`
      SELECT max(received_at) AS last_at, count(*) FILTER (WHERE received_at > now() - interval '1 day') AS day,
             count(*) FILTER (WHERE received_at > now() - interval '1 day' AND processed_at IS NULL) AS errors
      FROM webhook_events`);
    const jobs = await query<{ job: string; trigger: string; started_at: Date; finished_at: Date | null; pharmacies: number; failed: number; detail: string | null }>(`
      SELECT DISTINCT ON (job) job, trigger, started_at, finished_at, pharmacies, failed, detail FROM platform_job_runs ORDER BY job, started_at DESC`);
    return { tenants, recurring, payments, plans, database, webhooks, jobs };
  });
  const latency = Date.now() - started;

  const sum = (status: string, purpose?: string) => data.payments.filter((row) => row.status === status && (!purpose || row.purpose === purpose));
  const total = (rows: typeof data.payments) => ({ count: rows.reduce((acc, row) => acc + n(row.count), 0), byCurrency: Object.entries(rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.currency]: (acc[row.currency] ?? 0) + n(row.amount) }), {})).map(([currency, amount]) => ({ currency, amount })) });

  const gateway = await paystackConfig();
  const paystackChecks = await lastChecks("paystack");
  const emailChecks = await lastChecks("email");
  const emailReady = await emailConfigured();
  const [mail] = await platformQuery<Array<{ failed: Count; retrying: Count; sent: Count }>>((query) =>
    query(`SELECT count(*) FILTER (WHERE status = 'FAILED') AS failed, count(*) FILTER (WHERE status = 'RETRYING') AS retrying, count(*) FILTER (WHERE status = 'SENT') AS sent
           FROM email_deliveries WHERE created_at > now() - interval '1 day'`),
  );
  const [backup] = await platformQuery<Array<{ taken_at: Date; label: string }>>((query) => query(`SELECT taken_at, label FROM platform_backups ORDER BY taken_at DESC LIMIT 1`));
  const backupDays = backup ? (Date.now() - new Date(backup.taken_at).getTime()) / 86_400_000 : null;
  const { systemConfig } = await import("@/lib/platform/system");
  const system = await systemConfig();
  const lastJob = data.jobs.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];

  const health: Health[] = [
    { name: "Database", status: latency < 2000 ? "ok" : "warning", detail: `Connected (PostgreSQL ${data.database.version}); ${(n(data.database.size) / 1024 / 1024).toFixed(1)} MB; dashboard queries took ${latency} ms`, checkedAt: new Date().toISOString() },
    {
      name: "Email service",
      status: !emailReady ? "warning" : emailChecks.last ? (emailChecks.last.ok ? (n(mail.failed) > 0 ? "warning" : "ok") : "error") : "unknown",
      detail: !emailReady
        ? "Not configured or turned off: account and alert emails are skipped."
        : `${emailChecks.last ? emailChecks.last.detail : "Configured, but no connection test has been run yet."} Last 24 h: ${n(mail.sent)} sent, ${n(mail.failed)} failed, ${n(mail.retrying)} waiting to retry.`,
      checkedAt: emailChecks.last?.at ?? null,
    },
    {
      name: "Payment gateway (Paystack)",
      status: gateway.source === "none" ? "warning" : paystackChecks.last ? (paystackChecks.last.ok ? "ok" : "error") : "unknown",
      detail: gateway.source === "none"
        ? "Not configured: pharmacies cannot pay online."
        : `${gateway.mode === "live" ? "Live" : "Test"} mode, keys from ${gateway.source}. ${paystackChecks.last ? paystackChecks.last.detail : "No connection test has been run yet."}`,
      checkedAt: paystackChecks.last?.at ?? null,
    },
    {
      name: "Paystack webhooks",
      status: n(data.webhooks.errors) > 0 ? "warning" : data.webhooks.last_at ? "ok" : "unknown",
      detail: data.webhooks.last_at ? `Last received ${new Date(data.webhooks.last_at).toISOString().replace("T", " ").slice(0, 16)} UTC; ${n(data.webhooks.day)} in 24 h, ${n(data.webhooks.errors)} not processed.` : "None received yet.",
      checkedAt: data.webhooks.last_at ? new Date(data.webhooks.last_at).toISOString() : null,
    },
    {
      name: "Background jobs",
      status: !lastJob ? "unknown" : lastJob.failed > 0 || !lastJob.finished_at ? "warning" : Date.now() - new Date(lastJob.started_at).getTime() > 26 * 3_600_000 ? "warning" : "ok",
      detail: lastJob ? `Last run: ${lastJob.job} (${lastJob.trigger}) at ${new Date(lastJob.started_at).toISOString().replace("T", " ").slice(0, 16)} UTC, ${lastJob.pharmacies} pharmacies, ${lastJob.failed} failed. ${lastJob.detail ?? ""}` : "No run recorded yet.",
      checkedAt: lastJob ? new Date(lastJob.started_at).toISOString() : null,
    },
    {
      name: "Backups",
      status: backupDays === null ? "warning" : backupDays > 7 ? "warning" : "ok",
      detail: backup ? `Last recorded backup "${backup.label}" ${new Date(backup.taken_at).toISOString().replace("T", " ").slice(0, 16)} UTC (${Math.floor(backupDays!)} day(s) ago).` : "No backup recorded. Run npm run db:backup, or note a host backup on the System page.",
      checkedAt: backup ? new Date(backup.taken_at).toISOString() : null,
    },
    {
      name: "Maintenance mode",
      status: system.maintenance ? "warning" : "ok",
      detail: system.maintenance ? "ON: pharmacies cannot use the system." : `Off. Registration ${system.registrationOpen ? "open" : "closed"}; trials ${system.trialsEnabled ? "on" : "off"}.`,
      checkedAt: null,
    },
  ];

  return {
    tenants: Object.fromEntries(Object.entries(data.tenants).map(([key, value]) => [key, n(value)])) as Record<"total" | "demo" | "active" | "trial" | "suspended" | "expired" | "past_due" | "new_30" | "new_7", number>,
    recurring: data.recurring.map((row) => ({ currency: row.currency, mrr: n(row.mrr), arr: n(row.mrr) * 12, subscriptions: n(row.subscriptions), unpriced: n(row.unpriced) })),
    payments30: { successful: total(sum("SUCCESS")), failed: total([...sum("FAILED"), ...sum("ABANDONED")]), renewals: total(sum("SUCCESS", "RENEWAL")), pending: total(sum("PENDING")) },
    plans: data.plans.map((row) => ({ name: row.name, count: n(row.count) })),
    jobs: data.jobs.map((job) => ({ ...job, started_at: new Date(job.started_at).toISOString(), finished_at: job.finished_at ? new Date(job.finished_at).toISOString() : null })),
    health,
    generatedAt: new Date().toISOString(),
  };
}

/** The richer dashboard panels, all from the database: revenue by month, users, recent pharmacies and activity. */
export async function dashboardExtras() {
  return platformQuery(async (query) => {
    const revenue = await query<{ month: Date; currency: string; amount: Count; count: Count }>(`
      SELECT date_trunc('month', coalesce(paid_at, created_at)) AS month, currency, sum(amount) AS amount, count(*) AS count
      FROM billing_payments WHERE status = 'SUCCESS' AND coalesce(paid_at, created_at) >= date_trunc('month', now()) - interval '5 months'
      GROUP BY 1, 2 ORDER BY 1`);
    const [users] = await query<{ total: Count; new_month: Count }>(`
      SELECT count(*) AS total, count(*) FILTER (WHERE m.created_at >= date_trunc('month', now())) AS new_month
      FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id WHERE NOT t.is_demo AND m.status = 'ACTIVE' AND t.status = 'ACTIVE'`);
    const [pharmacies] = await query<{ new_month: Count }>(`SELECT count(*) AS new_month FROM tenants WHERE NOT is_demo AND created_at >= date_trunc('month', now())`);
    const recent = await query<{ id: string; name: string; status: string; plan: string | null; sub_status: string | null; ends: Date | null }>(`
      SELECT t.id, t.name, t.status, p.name AS plan, s.status AS sub_status, CASE WHEN s.status = 'TRIAL' THEN s.trial_ends_at ELSE s.current_period_end END AS ends
      FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id LEFT JOIN plans p ON p.id = s.plan_id
      WHERE NOT t.is_demo ORDER BY t.created_at DESC LIMIT 5`);
    const activity = await query<{ at: Date; actor_name: string; action: string; summary: string; severity: string }>(`
      SELECT at, actor_name, action, summary, severity FROM platform_audit_events ORDER BY at DESC LIMIT 6`);
    const [overview] = await query<{ db_size: Count; emails_sent: Count; emails_failed: Count; open_tickets: Count; last_backup: Date | null; sign_ins: Count; failed_sign_ins: Count }>(`
      SELECT pg_database_size(current_database()) AS db_size,
             (SELECT count(*) FROM email_deliveries WHERE status = 'SENT' AND created_at > now() - interval '1 day') AS emails_sent,
             (SELECT count(*) FROM email_deliveries WHERE status = 'FAILED' AND created_at > now() - interval '1 day') AS emails_failed,
             (SELECT count(*) FROM support_tickets WHERE status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER')) AS open_tickets,
             (SELECT max(taken_at) FROM platform_backups) AS last_backup,
             (SELECT count(*) FROM sign_in_attempts WHERE outcome = 'success' AND at > now() - interval '1 day') AS sign_ins,
             (SELECT count(*) FROM sign_in_attempts WHERE outcome IN ('bad_password', 'two_factor_failed') AND at > now() - interval '1 day') AS failed_sign_ins`);

    // Six calendar months, oldest first, in the main currency (other currencies are listed separately).
    const currencies = [...new Set(revenue.map((row) => row.currency))];
    const currency = currencies.includes("NGN") || !currencies.length ? "NGN" : currencies[0];
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setUTCDate(1);
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCMonth(date.getUTCMonth() - (5 - index));
      return date;
    });
    const series = months.map((month) => {
      const row = revenue.find((entry) => entry.currency === currency && new Date(entry.month).getTime() === month.getTime());
      return { month: month.toISOString().slice(0, 7), label: month.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), amount: n(row?.amount ?? 0), payments: n(row?.count ?? 0) };
    });
    const thisMonth = series.at(-1)!.amount;
    const lastMonth = series.at(-2)!.amount;
    return {
      revenue: { currency, otherCurrencies: currencies.filter((entry) => entry !== currency), series, total: series.reduce((sum, row) => sum + row.amount, 0), thisMonth, lastMonth, change: lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null },
      users: { total: n(users?.total), newThisMonth: n(users?.new_month) },
      pharmaciesNewThisMonth: n(pharmacies?.new_month),
      recent: recent.map((row) => ({ ...row, ends: row.ends ? new Date(row.ends).toISOString() : null })),
      activity: activity.map((row) => ({ ...row, at: new Date(row.at).toISOString() })),
      overview: {
        databaseBytes: n(overview?.db_size), emailsSent: n(overview?.emails_sent), emailsFailed: n(overview?.emails_failed), openTickets: n(overview?.open_tickets),
        lastBackup: overview?.last_backup ? new Date(overview.last_backup).toISOString() : null, signIns: n(overview?.sign_ins), failedSignIns: n(overview?.failed_sign_ins),
      },
    };
  });
}
