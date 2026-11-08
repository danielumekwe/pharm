# Tenancy migration (SaaS Phase 1): backup, apply, verify, roll back

Phase 1 turns the single-pharmacy database into a multi-tenant one. All existing records move into one
default tenant, `tenant-demo`. The change is additive: no rows are deleted and no IDs change.

> **Live database:** do not run any step below against Neon until the product owner approves it in writing.
> Every script refuses a non-local database unless `--confirm-remote` is passed.

## What changes in the database

| Migration | Changes |
| --- | --- |
| `20261107100000_tenants` | New `tenants` table with the demo tenant. New `tenant_memberships` table (one row per user per tenant: role, status, grants, default outlet, staff ID). `tenant_id NOT NULL` + tenant foreign key + index on 30 tables. Platform keys in `app_state` move to scope `_platform`; its key becomes `(tenant_id, key)`. `user_outlets` key becomes `(tenant_id, user_id, position)`. Nine global unique keys become per tenant (outlet, customer and supplier codes; sale, PO, return and expense numbers; transfer reference; registration product name). Staff ID uniqueness moves from `users` to memberships. 28 composite foreign keys `(tenant_id, x_id) → parent (tenant_id, id)`, checked at commit. Built-in validation aborts the migration if any row lacks a tenant or a user lacks a membership. |
| `20261107100100_tenant_rls` | Row Level Security, enabled and forced, on the 30 tenant tables. Rows are visible and writable only when `tenant_id = current_setting('app.tenant_id')`. `app_state` also shows `_platform` rows. |

Unchanged and global: `users` (one account per person, emails unique platform-wide) and `devices`.

The application sets `app.tenant_id` at the start of every transaction (`lib/db/database.ts`). It loads only that tenant's rows, stamps `tenant_id` on every write, and refuses (rolling back the request) to overwrite a row ID owned by another tenant. In Phase 1 the tenant is always `tenant-demo` (`lib/saas/tenant.ts`).

## 1. Back up

Neon (when approved): first create a **Neon branch** of the production branch in the Neon console. It is an instant, complete copy and the fastest way back. Then also take a JSON backup:

```bash
DIRECT_DATABASE_URL='<direct Neon URL>' npm run db:backup -- --label pre-tenancy --confirm-remote
```

Local: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run db:backup -- --label pre-tenancy`

The backup is written to `.data/backups/<label>-<timestamp>/` (`backup.json` plus `manifest.json` with row counts). It reads one consistent snapshot and, once RLS is on, reads tenant by tenant, so it needs no policy bypass.

## 2. Rehearse on a copy

Restore the backup into a scratch database (or a Neon branch), apply the migrations there, and run steps 3 and 4. This was done on 7 November 2026 with the live backup of 5 November (1,577 sales, 3,089 sale lines, 1,338 payments): every count and total matched, the rollback was lossless, and re-applying after rollback worked.

```bash
DATABASE_URL=<scratch> npm run db:restore -- --file .data/backups/<dir>/backup.json --confirm-overwrite
```

## 3. Apply

```bash
DIRECT_DATABASE_URL=<target> npx prisma migrate deploy
```

Both migrations run in their own transaction: a failure leaves the database as it was.

## 4. Verify

```bash
DATABASE_URL=<target> npm run db:verify-tenancy -- --backup .data/backups/<dir>/backup.json
```

The script compares row counts for every table, money and stock totals (sales, payments, expenses, purchase orders, batch quantities, ledger, product stock), and memberships against the backup. It exits with code 1 on any mismatch. Then sign in, make a POS sale, request a transfer, and open `GET /api/stock-ledger?verify=1` (it should report 0 issues).

## 5. Roll back

Option A, rollback scripts. These keep data written after the migration, as long as only `tenant-demo` exists. Run them in this order, then redeploy the pre-Phase-1 application code:

```bash
psql "$DIRECT_DATABASE_URL" -f prisma/rollbacks/20261107100100_tenant_rls/down.sql
psql "$DIRECT_DATABASE_URL" -f prisma/rollbacks/20261107100000_tenants/down.sql
```

No `psql`? Run each file with any PostgreSQL client. Each script is one transaction and removes its migration from `_prisma_migrations`. The second script refuses to run if any tenant besides `tenant-demo` exists, because dropping `tenant_id` would merge pharmacies.

Option B, restore. Switch the app back to the Neon branch from step 1, or restore `backup.json` with `npm run db:restore` into a database at the pre-tenancy schema. Anything written after the backup is lost.

## Before applying to Neon

- [ ] Product owner approval
- [ ] Neon branch and JSON backup taken
- [ ] Run `prisma/sql/app-role.sql` once as the database owner, and set `DATABASE_APP_ROLE=pharm_app` on the app (Phase 2). Every transaction then runs `SET LOCAL ROLE pharm_app`, a role without `BYPASSRLS`. Without it, Row Level Security may not apply on Neon, where the owner role can bypass it.
- [ ] Deploy the Phase 1 and 2 code in the same window. The old code cannot write to the migrated schema, because `tenant_id` is required.
- [ ] Expect everyone to sign in again. Sessions from before Phase 2 carry no pharmacy and are treated as signed out.

## Phase 2 (tenant context): what changes at runtime

No database change. The app now:

- Resolves the pharmacy for every transaction from the signed session or mobile token (or an explicit server-side scope for sign-in, invitations and jobs). It never reads it from request data.
- Loads only that pharmacy's rows. Reading ERP data outside a transaction throws, so a page or route can never show another pharmacy's data left in memory.
- Signs in with email or staff ID and password first, then lists only that account's pharmacies and locations (`POST /api/auth/pharmacies`). The public sign-in page shows no outlet names.
- Takes role, status, permissions, default outlet and staff ID from the membership (`tenant_memberships`). The same columns on `users` are left untouched for rollback.
- Gives other pharmacies' new records platform-unique IDs (`aud-<tenant>-<n>`). The demo pharmacy keeps `aud-<n>`.
- Runs scheduled jobs once per active pharmacy.
- Stores new Cloudflare R2 files under `<tenant>/<name>`.
- Rate-limits sign-in per server instance: 10 failed attempts per account name, and 60 requests per address, per 15 minutes. `RATE_LIMIT=off` disables it (tests only).

## Phase 3 (registration and onboarding)

Migration `20261108090000_registration` (rollback: `prisma/rollbacks/20261108090000_registration/down.sql`, run before the Phase 1 rollbacks):

- `plans`: Starter, Professional and Enterprise, with prices left empty until Web365 sets them. 14-day trial.
- `subscriptions`: one per pharmacy. New pharmacies start on `TRIAL`; the demo pharmacy is `ACTIVE` on Enterprise.
- `auth_tokens`: single-use, hashed tokens for email confirmation (48 hours) and password reset (60 minutes).
- `users.email_verified_at`: existing accounts are marked confirmed at migration time.
- `users.password_changed_at`: sessions signed in before a password change are refused.
- `tenants.registration_key`: makes a repeated registration return the same pharmacy.

Rehearsed on 7 November 2026 on the migrated copy of the live backup: every count and total matched, the demo got its subscription, there was no Prisma drift, the rollback was lossless, and re-applying worked.

Going live also needs:

- [ ] `APP_URL` set to the public address, because email links point there.
- [ ] SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_FROM`). Without them, confirmation and reset emails are skipped: pharmacies can still register and use the app, but cannot confirm their email or reset a forgotten password themselves.
- [ ] `NEXT_PUBLIC_DEMO_MODE=1` only on the demo deployment, to keep the demo-account shortcuts on the sign-in page. It is set at build time.
- [ ] Re-run `prisma/sql/app-role.sql` after migrating, so `pharm_app` can use the new tables. It is safe to run again.

## Phase 4 (platform administration)

Migration `20261109090000_platform_admin` (rollback: `prisma/rollbacks/20261109090000_platform_admin/down.sql`; back up first, because it drops the platform audit trail):

- `platform_users`: Web365 staff accounts, separate from pharmacy accounts. Roles are `PLATFORM_SUPER_ADMIN` and `PLATFORM_SUPPORT`.
- `platform_audit_events`: append-only for `pharm_app` (re-run `prisma/sql/app-role.sql` after migrating, which revokes UPDATE and DELETE).
- `support_access_grants`: support access that Web365 requests and the pharmacy approves, deny or revokes.
- `tenants.status_reason` and `tenants.status_changed_at`: the suspension reason shown to the pharmacy's users.
- `auth_tokens.tenant_id` and purpose `join_pharmacy`: invitations for existing accounts to join another pharmacy.

Rehearsed on 8 November 2026 on the live-data copy: all counts and totals matched, there was no Prisma drift, the app role cannot edit or delete audit rows, the rollback was lossless, and re-applying worked.

After migrating, create the first Platform Super Admin. The password is read from the environment and is never printed:

```bash
PLATFORM_ADMIN_PASSWORD='<12+ characters>' DIRECT_DATABASE_URL=<target> npm run platform:create-admin -- --email you@web365.ng --name "Your Name" [--confirm-remote]
```

Without `PLATFORM_ADMIN_PASSWORD`, a strong password is generated and printed once. Sign in at `/platform/login`. Further staff accounts are added from **Platform staff**.

## Phase 5 (plans, quotas and subscription enforcement)

Migration `20261110090000_plan_limits` (rollback: `prisma/rollbacks/20261110090000_plan_limits/down.sql`):

- Adds optional `max_outlets`, `max_staff_accounts` and `features` (a JSON array of feature keys) to `plans`.
- Seeds the documented limits: Starter is 1 outlet / 3 staff accounts; Professional is 3 outlets / 10 staff accounts. Enterprise limits remain unset because the Phase 4 results do not give numeric values.
- Prices and feature lists remain unset until Web365 confirms them. An unset feature list does not change existing access. Currently enforced feature keys are `stock_transfers` and `regulatory_management`; an enabled empty list denies both.
- Enforces outlet and staff caps when creating an outlet, inviting a staff account, or reactivating a deactivated account. Existing records are not deleted or disabled when a cap is lowered.
- `TRIAL` is allowed until `trial_ends_at`; `ACTIVE` and an unexpired `GRACE` period are allowed. A grace period must have a future `current_period_end`. An ended trial, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, or `EXPIRED` subscription blocks pharmacy pages and APIs. Users are routed to `/subscription` for status and support instructions. Approved read-only Web365 support sessions are unaffected.
- Adds platform controls at `/platform/plans` for prices, limits, trials, visibility and supported feature allowlists. A platform Super Admin can change a pharmacy's plan or subscription status on its detail page. Each change is recorded in the platform audit trail.

The migration does not set prices or guess Enterprise quotas. After product approval, fill these in under **Plans** before public registration is enabled. No payment processor or automatic payment-status updates are included in this phase; Web365 must set subscription status from the platform until a billing integration is added.

Before applying to Neon:

- [ ] Rehearse the migration and rollback on a fresh copy; verify registration still shows unset prices accurately and that over-limit additions return a clear error.
- [ ] Product owner approval and a fresh backup/Neon branch.
- [ ] Deploy the migration and Phase 5 code in the same window, then re-run `prisma/sql/app-role.sql`.
- [ ] Review each plan's limits, prices, visibility and feature allowlist in `/platform/plans`; specifically decide the Enterprise quotas before selling that plan.
- [ ] Confirm subscription statuses are monitored and manually updated while payment integration is absent.

## Phase 6 (payments and billing)

Migration `20261111090000_billing` (rollback: `prisma/rollbacks/20261111090000_billing/down.sql`, run before the Phase 5 rollback; it refuses once any payment has succeeded):

- `billing_payments`: every payment attempt, with the server-calculated amount.
- `invoices`: one per successful payment, numbered `W365-<year>-<6 digits>` from `invoice_number_seq`.
- `webhook_events`: every webhook, processed once.
- On `subscriptions`: saved card, scheduled downgrade, and cancel at period end.
- `app-role.sql`: re-run it. It now grants the app use of the invoice sequence, and stops the app deleting payments, invoices and webhook events.

Rehearsed on 8 November 2026 on the live-data copy, together with the Phase 5 migration: all counts and totals matched, there was no Prisma drift, the app cannot delete invoices, rolling back Phases 6 and 5 was lossless, and re-applying worked.

### Paystack setup

1. Set `PAYSTACK_SECRET_KEY` (`sk_test_…` first, then `sk_live_…`) on the app. Leave `PAYSTACK_BASE_URL` unset. Never put the key in code or the browser.
2. In the Paystack dashboard, set the webhook URL to `https://<APP_URL>/api/billing/webhooks/paystack`. The checkout return address (`/billing/callback`) is sent with each payment.
3. Set plan prices on the platform's Plans page. Unpriced plans cannot be bought.
4. Test with Paystack's test cards before switching to the live key.

How a payment counts: the redirect back from Paystack and the webhook both call one function that verifies the transaction with Paystack's API (status, reference, amount and currency). It then applies it once, in one database transaction, and issues the invoice. A charge for an unknown reference, or for the wrong amount, is logged in the platform audit as critical for a manual check. On a pharmacy's platform page, pending payments can be re-checked with **Check with Paystack again**.

## Phase 7A (Control Centre foundation)

Migration `20261112090000_platform_settings` (rollback: `prisma/rollbacks/20261112090000_platform_settings/down.sql`, run before the Phase 6 rollback; it drops saved settings and their history):

- `platform_settings`: secrets only as AES-256-GCM ciphertext.
- `platform_settings_history`: masked, and append-only for the app.
- `user_preferences`: each person's own preferences.
- `integration_checks`: results of real connection tests.
- `platform_job_runs`: background job runs.
- Two new platform roles: `BILLING_ADMIN` and `TECHNICAL_ADMIN`.

Re-run `prisma/sql/app-role.sql` afterwards. Rehearsed on 8 November 2026 on the live-data copy: counts and totals matched, there was no drift, and the rollback was lossless.

Going live also needs:

- [ ] `SETTINGS_ENCRYPTION_KEY`: at least 32 random characters, as a server secret (for example `openssl rand -base64 48`). Keep a copy in a password manager: without it, saved secrets cannot be read and must be entered again. Never commit it.
- [ ] Payment keys: enter them on **Control Centre → Payment gateway** (stored encrypted, never shown again). Start in test mode, run **Test connection**, then switch to live. The environment variable `PAYSTACK_SECRET_KEY` remains a fallback, used only when the settings are not enabled.
- [ ] The live Paystack key shared in chat on 8 November 2026 must be rolled in the Paystack dashboard before use.

## Phase 7B (email)

Migration `20261113090000_email` (rollback: `prisma/rollbacks/20261113090000_email/down.sql`, run before the 7A rollback; it drops the delivery log and edited templates):

- `email_deliveries`: one row per email sent, failed, waiting to retry or not sent. The app cannot delete it. A message body is kept only while a platform email waits to be retried, and only encrypted (it can contain a one-time link). Pharmacy alert emails are logged without their subject.
- `email_templates`: templates edited on **Control Centre → Email → Email templates**. Built-in defaults stay in code until a template is saved.

Re-run `prisma/sql/app-role.sql` afterwards. Rehearsed on 8 November 2026 on the live-data copy: counts and totals matched, there was no drift, the rollback was lossless (0 tables differ) and re-applying worked.

Failed platform emails (account, billing, notices) are retried after 5 minutes, 30 minutes, 2 hours and 12 hours, then marked failed. The retry queue runs with the existing scheduled jobs: the Vercel cron (`GET /api/alerts/jobs`), the Worker cron, and the in-process scheduler.

Going live also needs:

- [ ] ZeptoMail: verify `pharmerp.name.ng` as a sending domain (add the SPF and DKIM DNS records ZeptoMail shows, and wait until both show as verified). Without this, emails from `support@pharmerp.name.ng` are refused or land in spam.
- [ ] Create a Mail Agent and generate a **new** Send Mail token. The token shared in chat on 8 November 2026 must be deleted in ZeptoMail and not used.
- [ ] Enter it on **Control Centre → Email**: ZeptoMail API, the region of the ZeptoMail account (`zeptomail.com` unless the account is on another data centre), sender `support@pharmerp.name.ng`. Save, run **Test connection** (checks the token, sends nothing), then **Send test email** to a real inbox.
- [ ] Optional: a "new pharmacy" notification address, which gets an email when a pharmacy registers.
- [ ] Once Control Centre email settings are saved, they replace the `SMTP_*` / `ALERT_EMAIL_FROM` environment variables. Unticking **Send email with these settings** turns all email off (each email is logged as not sent).

## Phase 7C (pharmacies and subscriptions)

Migration `20261114090000_tenant_admin` (rollback: `prisma/rollbacks/20261114090000_tenant_admin/down.sql`, run before the 7B rollback; it drops closure requests, the adjustment ledger and refund records, and sets refunded invoices back to `PAID`):

- `tenant_deletion_requests`: a pharmacy's request to close its account. At most one open request per pharmacy. The app cannot delete these records.
- `tenants.purge_after`: for a closed pharmacy, the earliest date its data may be deleted.
- `subscription_adjustments`: every manual subscription change, with its reason and the values before and after. It is append-only for the app.
- `billing_refunds`: refund requests, approvals and the provider's status. The app cannot delete these records.
- `invoices.status` may now also be `PARTIALLY_REFUNDED` or `REFUNDED`.

Re-run `prisma/sql/app-role.sql` afterwards. Rehearsed on 8 November 2026 on the live-data copy: counts and totals matched, there was no drift, the rollback was lossless (0 tables differ) and re-applying worked.

How it works:

- **Grace period.** A paid subscription whose period has ended keeps working for the policy's grace days (default 3), unless it was cancelled. Set this on **Control Centre → Billing policy**; 0 turns grace off.
- **Refunds.** A billing administrator requests a refund with a reason. By default a second billing administrator must approve it, and only then is it sent to Paystack. The amount can never exceed what was paid minus other refunds that are requested, pending or done. Paystack's refund webhooks only trigger a fresh check with Paystack's API. If Paystack cannot be reached, the refund stays pending with a warning to check the Paystack dashboard, so it is never sent twice. A refund does not change the subscription.
- **Closing an account.** The pharmacy's Super Admin asks from the Subscription page, confirming with their password. A Platform Super Admin approves or declines the request. Approval closes the pharmacy (no sign-ins) and cancels its subscription. The data is kept until `purge_after` (policy default 90 days). Purging is not automatic: it is a separate step, still to be built, that will need explicit approval.

Going live also needs:

- [ ] In the Paystack dashboard, make sure the webhook URL also receives refund events (`refund.processed`, `refund.failed`, …). They use the same URL as payments.
- [ ] Check the billing policy (grace days, refund approval, data retention) before the first renewal.
- [ ] At least two people with the Billing Administrator or Platform Super Admin role, if refunds need two-person approval.

## Phase 7D (platform security)

Migration `20261115090000_platform_security` (rollback: `prisma/rollbacks/20261115090000_platform_security/down.sql`, run before the 7C rollback; it drops two-factor enrolments, sessions and the sign-in log):

- `platform_users`: new columns for two-factor sign-in (secret as AES-256-GCM ciphertext, recovery codes as keyed hashes, the last used code step) and `password_must_change`.
- `platform_sessions`: server-side platform sessions. They are revoked, never deleted.
- `sign_in_attempts`: every platform and pharmacy sign-in attempt (no passwords or codes). It is append-only for the app.

Re-run `prisma/sql/app-role.sql` afterwards. Rehearsed on 8 November 2026 on the live-data copy: counts and totals matched, there was no drift, the rollback was lossless (0 tables differ) and re-applying worked.

**Deploying this signs every platform staff member out once.** Old cookies have no session row.

How it works:

- **Sessions.** The cookie holds a session id that is checked on every request. A session ends on sign-out, after `sessionHours` (default 8), after `idleMinutes` without activity (default 60), on a password change, on suspension, or when a Super Admin ends it.
- **Lockout.** After `maxFailedAttempts` wrong passwords or codes (default 5), an account is locked for `lockoutMinutes` (default 15). The count comes from the database, so it holds across server instances. Pharmacy sign-ins keep their limit of 10 failures per 15 minutes, now also counted in the database.
- **Two-factor sign-in.** Uses an authenticator app (TOTP), with 10 single-use recovery codes. It needs `SETTINGS_ENCRYPTION_KEY`. A Super Admin can reset someone's setup (for a lost phone); this ends all their sessions and is logged as critical.
- **Temporary passwords.** Staff created in the Control Centre must choose their own password at the first sign-in.
- **IP allowlist** (optional). It limits the Control Centre to listed addresses or ranges and does not affect pharmacies. It relies on the address the hosting proxy reports in `X-Forwarded-For` (set by Vercel and Cloudflare). If an allowlist ever locks everyone out, clear it in the database: `UPDATE platform_settings SET value = jsonb_set(value, '{ipAllowlist}', '[]') WHERE key = 'security.policy';`

Going live also needs:

- [ ] Each platform staff member: turn on two-factor sign-in on **My security**. Then a Super Admin can tick **Require two-factor sign-in** on **Security policy**.
- [ ] Check that everyone still has a working sign-in after deploying, since everyone is signed out once.

## Phase 7E (system configuration and backups)

Migration `20261116090000_system` (rollback: `prisma/rollbacks/20261116090000_system/down.sql`, run before the 7D rollback; it drops the backup history list, not the backup files):

- `platform_backups`: the backup history. `npm run db:backup` adds a row after its snapshot (`--no-record` skips it). Backups taken at the host (such as a Neon branch) can be noted on **Control Centre → System**. The history is append-only for the app. `tenancy-verify` ignores this table, because the pre-migration backup itself adds a row to it.

Re-run `prisma/sql/app-role.sql` afterwards. Rehearsed on 8 November 2026 on the live-data copy: counts and totals matched, there was no drift, recording a backup worked, the rollback was lossless (0 tables differ) and re-applying worked.

**Control Centre → System** (Technical and Super Admins) holds one settings record, `system.config`, read fresh on every request:

- **Maintenance mode**: pharmacy sign-in, pages (redirected to `/maintenance`), APIs (503) and self-registration pause, with a message. The Control Centre and Web365 support sessions keep working.
- **Registration and trials**: close self-registration (Web365 can still create pharmacies), switch trials off (new pharmacies start `EXPIRED` and must pay), or set a trial length for new registrations.
- **Feature switches**: turning stock transfers or regulatory management off refuses them for every pharmacy on the server, whatever the plan.
- **Uploads**: the largest regulatory document size (1–10 MB; Vercel allows about 4.5 MB per request), the allowed document types, and the largest logo size. File contents are always checked against their type.
- **Scheduled jobs**: switch the alert jobs or the email retry queue off. Scheduled runs are then skipped and logged as skipped; **Run now** still runs them.

The page also shows the version, commit, runtime, database size, largest tables and latest migration. The dashboard health now includes **Backups** (warns when there is none in the last 7 days) and **Maintenance mode**.

Going live also needs:

- [ ] Before each deployment, take a backup (`npm run db:backup -- --confirm-remote` against Neon, or create a Neon branch and note it on the System page).

## Phase 7F (support, announcements, help, branding, notifications, integrations)

Migration `20261117090000_support` (rollback: `prisma/rollbacks/20261117090000_support/down.sql`, run before the 7E rollback; it drops tickets, announcements and help articles):

- `support_tickets` (numbered from `support_tickets_number_seq`) and `support_messages`. Messages are append-only for the app, and tickets cannot be deleted. Internal notes are never shown to the pharmacy.
- `announcements` (audience: all pharmacies, or by plan, subscription status or named pharmacies; optional start and end dates) and `announcement_reads` (who dismissed which).
- `kb_articles`: the help articles pharmacies see under **Help Articles**.

Re-run `prisma/sql/app-role.sql` afterwards. Rehearsed on 8 November 2026 on the live-data copy: counts and totals matched, there was no drift, the rollback was lossless (0 tables differ) and re-applying worked.

How it works:

- **Pharmacies**: **Help & Support** to open tickets and reply, **Help Articles** to read the knowledge base, and announcement banners at the top of every page.
- **Web365**: **Support** (queue, assign, priority, status, replies, internal notes), **Announcements**, **Help articles**, **Branding**, and **Integrations**.
- The two new platform permissions, `support.tickets` and `content.manage`, belong to Platform Super Admins and Platform Support.
- **Emails**: staff replies are emailed to whoever opened the ticket. New tickets and pharmacy replies go to the new-pharmacy notice address set on the Email page.
- **Notification switches**: alert emails, push notifications, billing emails and announcement emails can each be turned off platform-wide. Switched-off messages are logged as not sent. Account emails are always sent.
- **Branding**: the product name and support contact used in every email and on the Help pages.
