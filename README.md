# Web365 Pharmacy ERP

Multi-outlet pharmacy ERP built with Next.js 16, TypeScript, Tailwind CSS, Prisma 7, and PostgreSQL. Cloudflare deployment setup and operational steps are documented in [CLOUDFlARE_DEPLOYMENT.md](./CLOUDFlARE_DEPLOYMENT.md).

## Local development

Use PostgreSQL locally. Copy [.env.example](./.env.example) to `.env.local`, set a local PostgreSQL connection string and a unique `NEXTAUTH_SECRET`, then run:

```bash
npm ci
npx prisma migrate deploy
npm run dev
```

`DATABASE_URL` is used by the local app. `DIRECT_DATABASE_URL` is optional and is preferred by Prisma CLI commands for direct migrations. SQLite URLs are no longer supported by the application.

## Checks

```bash
npx prisma generate
npx tsc --noEmit
npm run build
npm test
```

The integration suite starts an isolated embedded PostgreSQL-compatible test database; it does not connect to or reset a developer or production database.

## Cloudflare

Build and run the local Worker preview with `npm run preview`. Deploy with `npm run deploy` after configuring the Hyperdrive, R2, and secret bindings described in the deployment guide. Never commit `.env.local`, `.dev.vars`, Neon credentials, or Cloudflare API tokens.

## Rate limits and API protection

The Platform Control Centre stores rate-limit policies, overrides, IP rules, and security events in PostgreSQL. Request counters use managed Redis (Upstash REST) with atomic sliding-window updates; there is deliberately no in-process or local-file fallback. Apply the rate-limit migration with the normal database migration process, then configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the server environment (Cloudflare Worker secrets or Vercel environment variables). Only then enable protection under **Security → Rate Limits & API Protection**. It is disabled by default until the distributed store is configured.

On custom hosting, set `RATE_LIMIT_TRUSTED_PROXY_HEADER` only when the trusted ingress overwrites that header and prevents clients from supplying it. Cloudflare and Vercel client addresses are read only from their hosting-provided headers; arbitrary forwarded-for values are ignored. If Redis becomes unavailable while protection is enabled, API requests fail closed with HTTP 503. `RATE_LIMITING_FORCE_OFF=1` is an emergency operator override and should normally remain unset.

## WhatsApp notifications (Zoho CPaaS)

WhatsApp messages are sent through Zoho CPaaS with Meta-approved templates. Apply the `20261119090000_whatsapp` migration with the normal process, then configure everything in the Control Centre under **Settings → WhatsApp**: data centre, agent API key, sender number, WABA ID, Phone Number ID, default country code and the webhook Authentication Key. Secrets are encrypted with `SETTINGS_ENCRYPTION_KEY` and never returned to the browser.

- **Templates**: create and submit each template in Zoho CPaaS, then record its key or alias and merge keys in the Control Centre. A template is used only once it is marked Approved and active (Zoho has no API to read approval status). A template Zoho refuses (`WA_103`) is marked Rejected automatically.
- **Webhook**: in Zoho CPaaS → Agents → Webhooks, add `<APP_URL>/api/webhooks/zoho-cpaas` with the WhatsApp delivered, read and undelivered events, and set the Authentication Key. Events with a missing, wrong or old signature are rejected.
- **Pharmacies** choose their recipients (with recorded consent), notification types and whether the daily report goes by email, WhatsApp or both under **Settings → WhatsApp notifications**. Every message carries an opt-out link.
- **Sending** happens in the background: events queue messages, and the platform job (`runPlatformJobs`, also started right after the triggering request) sends them, retrying temporary failures after 1, 5, 30 and 120 minutes. Messages not sent within 24 hours are dropped. On Vercel Hobby the cron runs once a day, so queued messages otherwise wait for the next request-triggered run or the daily cron.

Tests use a local fake of Zoho (`ZOHO_CPAAS_BASE_URL`); never set that variable in production.
