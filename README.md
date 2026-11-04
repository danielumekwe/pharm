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
