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
