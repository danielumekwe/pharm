# Cloudflare Deployment

This project uses the OpenNext Cloudflare adapter because the current app depends on NextAuth v4, which the vinext compatibility check flagged as unsupported. OpenNext preserves the Next.js 16 App Router and NextAuth implementation. Its build reported Node.js middleware support as experimental; verify authentication on every adapter upgrade.

The app's prior persistence was process-local state, not a production-ready PostgreSQL store. It now persists normalized ERP records in PostgreSQL through Prisma 7 and serializes writes using a transaction-level lock. This preserves current mutation logic and protects stock updates across Worker isolates, at the cost of loading the ERP collections for each request transaction. Load-test with realistic data before scaling.

## 0. Audit and compatibility findings (verified 4 Nov 2026)

These were measured on this codebase, not assumed.

| Area | Finding | Status |
| --- | --- | --- |
| Framework | Next.js 16.4.5 App Router, 24 pages, 43 route handlers, `proxy.ts`, no server actions, Turbopack CSS loader rule. | — |
| vinext 1.4.3 (`npx vinext check`) | 88% compatible. **Blocking:** NextAuth v4 unsupported (would require migrating auth, including impersonation, to better-auth). Turbopack loader rules ignored. | Not chosen |
| OpenNext Cloudflare 1.20.16 | Builds successfully. Warns that Node.js middleware (`proxy.ts`) support is experimental. | **Chosen** |
| Worker size | 24.9 MB raw / **5.69 MB gzipped**. Free plan limit is 3 MB, Workers Paid 10 MB. Largest contributors: `@react-pdf/renderer` (PDF reports), `exceljs`, Prisma, NextAuth. | **Workers Paid required** |
| CPU | Password hashing uses PBKDF2-SHA256 with 310,000 iterations, and every request loads the ERP collections. Both exceed the Free plan's 10 ms CPU per request. | **Workers Paid required** |
| Database in workerd | Originally **failed on every request**: a cached Prisma/pg pool was reused across requests (forbidden on Workers) and `DATABASE_URL` from `.env.local` overrode Hyperdrive. Fixed: Hyperdrive-only on Workers, one client per transaction. | Fixed, tested |
| Local secrets in bundle | OpenNext/Next bake `.env*` values into the server bundle; a local `NEXTAUTH_SECRET` was found inside `.open-next`. `npm run cf-build` now refuses to run when local env files exist (deploy from CI). | Guarded |
| Missing `NEXTAUTH_SECRET` | Previously fell back to a hard-coded secret (forgeable sessions). Production now fails closed. | Fixed |
| Background work | Notifications ran after the response (cancelled on Workers) and page-render alert scans were discarded. Now awaited before commit; page renders show committed alerts only. | Fixed, tested |
| SMTP (`nodemailer`) | Plain SMTP verified from inside workerd (local test server received every alert email once). **TLS SMTP (465/587) not verified** — confirm with your provider in a preview before relying on it. | Partly verified |
| PDF reports (`@react-pdf/renderer`) | Failed in the Worker (`No such module "#standard-fonts/Helvetica"`): pdfkit's Node build loads fonts with a runtime `require`. Fixed by `scripts/patch-pdfkit.mjs` (approved), which runs on `postinstall` and in `cf-build` and imports the same 14 font files statically. Re-check after pdfkit upgrades — the script fails loudly if pdfkit changes. | Fixed |
| R2 | Regulatory documents already use the `REGULATORY_DOCS_BUCKET` binding with access checks and rollback cleanup. | Tested locally |
| Scheduled jobs | `worker.mjs` runs the alert scan, email retries and daily/monthly summaries from a Cron Trigger (every minute). | Configured |

### Data-layer design and its limits

Every request runs one PostgreSQL transaction that takes a global row lock, loads all ERP tables into memory, runs the unchanged business logic and writes back the differences. This keeps stock updates serialised and correct across Worker isolates without rewriting business rules, but:

- Cost grows with database size (the integration suite takes ~120 s on PostgreSQL vs ~11 s on the old in-process store).
- Requests are processed one at a time system-wide.

It is acceptable for initial rollout with three outlets. Before data grows large (roughly tens of thousands of invoices) or concurrency rises, move hot paths (session checks, POS sale, stock movements) to targeted queries.

## 1. Prerequisites

- **Cloudflare Workers Paid plan** (see section 0: bundle size and CPU).

- Workers, Hyperdrive and R2 enabled on the account.
- Neon account and a PostgreSQL project/branch in the same region as the Worker where practical.
- GitHub repository connected to Cloudflare deployment secrets.
- Node.js 22.13 or newer for local development and CI.

Do not run a database reset. No previous Prisma migration history was present in the project; `prisma/migrations/20261104180000_initial/migration.sql` creates the PostgreSQL schema. Review it against the target database before the first migration. If the target already contains ERP tables, stop and reconcile schema/history before applying it.

## 2. Neon PostgreSQL

1. Create a Neon project and production database. Keep a separate branch/database for staging.
2. Record the **direct** Neon connection string for Prisma migrations. Keep it in a password manager or secret store; do not put it in `wrangler.jsonc` or source control.
3. Configure SSL as required by the Neon connection string (`sslmode=require`).
4. Configure automated Neon backups/point-in-time recovery according to the selected plan.
5. Before production cutover, inspect the existing pharmacy data source and complete any required import into PostgreSQL. The application refuses to seed an empty production database unless `SEED_DEMO_DATA=1` is explicitly supplied. Do not enable that setting for real pharmacy data.

For local development, create a local PostgreSQL database and set `DATABASE_URL` in the ignored `.env.local` file. `.env.example` shows the connection string expected by the local Wrangler Hyperdrive proxy.

## 3. Hyperdrive

Create a Hyperdrive configuration using the Neon **direct** database connection string:

```sh
npx wrangler hyperdrive create pharmacy-neon --connection-string='postgresql://USER:PASSWORD@HOST/DB?sslmode=require'
```

Copy the returned Hyperdrive ID into `wrangler.jsonc` in place of `REPLACE_WITH_HYPERDRIVE_ID`. Do not copy the password into that file. Hyperdrive stores and manages the origin credentials; the Worker reads the runtime URL from `env.HYPERDRIVE.connectionString`.

The local `localConnectionString` in `wrangler.jsonc` is for Wrangler's local preview only. Update its credentials if your local PostgreSQL account differs. Ordinary `next dev` uses local `.env.local` `DATABASE_URL`.

## 4. R2 buckets

Create two private buckets matching the names in `wrangler.jsonc`, or update the names there:

```sh
npx wrangler r2 bucket create pharmacy-regulatory-documents
npx wrangler r2 bucket create pharmacy-next-cache
```

- `REGULATORY_DOCS_BUCKET` stores private regulatory documents. The app serves files only through the authenticated `/api/regulatory/documents/[id]` route; do not enable public access or expose an `r2.dev` URL.
- `NEXT_INC_CACHE_R2_BUCKET` backs OpenNext's incremental cache.

The regulatory route validates title, category, outlet/product association, declared MIME type, size (5 MiB maximum), and file signature. Access is checked before download or deletion. R2 operations include compensating cleanup when the PostgreSQL transaction rolls back; R2 itself does not participate in PostgreSQL atomic transactions.

## 5. Secrets and environment

Set Worker secrets without committing them:

```sh
npx wrangler secret put NEXTAUTH_SECRET
npx wrangler secret put CRON_SECRET
```

Generate `NEXTAUTH_SECRET` with a secure random generator (for example `openssl rand -base64 32`). Configure it consistently before accepting sessions. `CRON_SECRET` is optional when using the Worker scheduled handler; it protects externally-triggered `POST /api/alerts/jobs` requests.

Set non-secret runtime variables in Cloudflare Worker settings or the `vars` section of `wrangler.jsonc`:

| Variable / binding | Purpose |
|---|---|
| `HYPERDRIVE` | PostgreSQL runtime connectivity; binding is configured in `wrangler.jsonc`. |
| `REGULATORY_DOCS_BUCKET` | Private regulatory upload storage. |
| `NEXT_INC_CACHE_R2_BUCKET` | OpenNext cache storage. |
| `NEXTAUTH_URL` | Canonical HTTPS application origin. |
| `APP_URL` | Links in alert emails; set to the same canonical origin. |
| `ALERT_SCHEDULER` | Keep `off` on Workers; the scheduled Worker entry runs `schedulerTick`. |
| `ALERT_EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` | Optional alert email settings. |
| `SMTP_PASS` | SMTP password; set as a secret, not a plaintext `vars` entry. |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` | Optional Firebase push notification configuration. |
| `FCM_PRIVATE_KEY` | Firebase service-account private key; set as a secret. |

`DATABASE_URL` is for local app execution. Do not configure production `DATABASE_URL`; production runtime must use the `HYPERDRIVE` binding. `DIRECT_DATABASE_URL` is used only by Prisma CLI migration commands, preferably from a protected CI secret or local ignored environment file.

## 6. Migrations

Generate the client and apply reviewed migrations using the direct Neon URL:

```sh
npx prisma generate
DIRECT_DATABASE_URL='postgresql://...neon.tech/DB?sslmode=require' npx prisma migrate deploy
```

The migration workflow applies pending migrations before deploying the Worker. It never runs `migrate reset`, `db push`, or a destructive reset. Back up the target database and review migration SQL before the first production application.

The repository previously had no Prisma migration history, so there is no prior Prisma history to preserve. The initial migration is additive table creation; do not mark it applied or edit existing tables manually without verifying the actual Neon schema.

## 7. Local development and preview

```sh
cp .env.example .env.local   # then set NEXTAUTH_SECRET
npm run db:local             # embedded PostgreSQL (PGlite) on 127.0.0.1:5432, migrations applied; keep running
npm run dev                  # in a second terminal
```

`npm run db:local` keeps its data in `.data/pglite` (ignored by git). Use `PGLITE_PORT`/`PGLITE_DIR` to change them. A real local PostgreSQL works too: point `DATABASE_URL` at it and run `npx prisma migrate deploy`.

For a Cloudflare Worker-compatible local preview, copy `.dev.vars.example` to `.dev.vars`, set local-only secrets, ensure local PostgreSQL matches `localConnectionString`, and run:

```sh
npm run preview              # builds with ALLOW_LOCAL_ENV_IN_BUILD=1 (local only, never uploaded)
```

The OpenNext preview runs the Worker locally in workerd with Wrangler bindings. Hyperdrive uses `localConnectionString`, which matches `npm run db:local`. `npm run build` is the standard Next.js build; `npm run preview`, `npm run upload`, and `npm run deploy` run the OpenNext Cloudflare build.

The integration test suite uses an isolated PGlite PostgreSQL-wire server with a fresh schema per test file. Tests do not connect to Neon and do not reset an existing database.

```sh
npm run build && npm test                  # Node.js (next start)
npm run cf-build:local && npm run test:worker   # same tests against the Worker in workerd via Hyperdrive
```

## 8. GitHub deployment

The workflow in `.github/workflows/deploy-cloudflare.yml` runs Prisma generation, the Next build, and the integration suite for pull requests and pushes to `main`. On `main`, it also runs `prisma migrate deploy` and deploys OpenNext.

Configure these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN` with Worker deployment and required R2/Hyperdrive read permissions.
- `CLOUDFLARE_ACCOUNT_ID`.
- `DIRECT_DATABASE_URL` for the Neon migration connection.

Configure `NEXTAUTH_SECRET` and other runtime secrets directly in Cloudflare Worker settings. Do not put runtime secrets in GitHub workflow variables or the repository. The workflow does not provision Neon, Hyperdrive, R2, domains, or Worker secrets.

Manual build and deployment:

Prefer the GitHub workflow. For a manual deployment, use a **clean checkout without `.env`, `.env.local`, `.env.production` or `.env.production.local`**: Next.js/OpenNext bake those values into the uploaded Worker, so `npm run cf-build` refuses to run while they exist.

```sh
npm ci
npm run build && npm test
npm run cf-build && npm run test:worker
DIRECT_DATABASE_URL='postgresql://...neon.tech/DB?sslmode=require' npx prisma migrate deploy
npx wrangler deploy
```

`npm run deploy` (OpenNext's deploy) is equivalent to the last step after `cf-build`. The `wrangler.jsonc` Worker name is `pharmacy`.

## 9. Custom domain

1. Add the domain/zone to Cloudflare and point its nameservers as instructed.
2. In Workers & Pages, attach the chosen hostname to the `pharmacy` Worker.
3. Set `NEXTAUTH_URL` and `APP_URL` to the canonical `https://` origin.
4. Verify HTTPS, sign-in/sign-out, password reset/invites, file access controls, and scheduled jobs on the custom domain.

## 10. Rollback

- For an application-only regression, use Cloudflare Workers' deployment history to roll back to the previous Worker version, or run `npx wrangler rollback` after confirming the target version.
- Do not assume Worker rollback reverses a database migration. Prefer forward-only, backward-compatible schema changes; restore a database backup only through an approved recovery procedure.
- Keep the prior Worker version available until authentication, all three outlets, inventory transactions, reports, and document access have been verified.

## 11. Backups and recovery

- Enable Neon point-in-time recovery/retention appropriate for pharmacy operations and take a protected backup before production migrations.
- Periodically export PostgreSQL with `pg_dump` to encrypted storage outside the production database account; test restoring into a separate Neon branch.
- Establish an R2 backup/replication and retention policy for regulatory documents and test retrieval. Do not make the bucket public to simplify backup.
- Restrict backup access, encrypt exports, record restore steps, and periodically test a complete database-plus-document recovery.

## 12. Known limitations and verification boundary

- vinext's compatibility check identified NextAuth as incompatible, so OpenNext was selected to preserve auth. The OpenNext build has previously warned that Node.js middleware support is experimental.
- Workers do not provide a general-purpose local filesystem. Application uploads now use R2; the old SQLite test harness was replaced with PostgreSQL-wire integration tests.
- The app uses `nodemailer` with SMTP. Cloudflare Workers does not provide the general TCP socket behavior expected by ordinary SMTP transports in all configurations. Verify the configured mail transport in a Worker preview; if SMTP is unavailable, choose an HTTPS email provider/relay before production rather than silently changing providers.
- The current test suite verifies authentication/impersonation, outlet isolation, alert delivery behavior, PostgreSQL persistence, and sales reports/returns. It does not substitute for a live Neon/Hyperdrive test or a full operational UAT covering every pharmacy workflow.
- No production deployment is claimed. Neon credentials, a Hyperdrive ID, R2 buckets, Cloudflare account secrets, and custom domain were not available during this preparation.

## 13. Decisions (4 Nov 2026)

1. **Workers Paid plan** — required (bundle 5.69 MB gzipped vs 3 MB Free limit; CPU use).
2. **PDF reports** — install-time pdfkit patch approved and enabled (`scripts/patch-pdfkit.mjs`).
3. **`proxy.ts`** — kept. It passes all tests in the Worker runtime; it only redirects signed-out users, and pages/APIs enforce authentication and permissions themselves. Re-test sign-in on every OpenNext upgrade; removing it would not weaken security if it ever breaks.
4. **Data-layer scaling** — launch with the current design; refactor hot paths (session checks, POS sale, stock movements) to targeted queries after launch, before data volume or concurrency grows significantly.
