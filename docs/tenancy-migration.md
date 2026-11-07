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
