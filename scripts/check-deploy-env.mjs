// Guards deployment builds: Next.js/OpenNext bake values from local .env files into the Worker bundle,
// which would ship local secrets (and local database URLs) to Cloudflare. Deploy builds must come from a
// clean checkout (e.g. GitHub Actions) with production secrets stored as Worker secrets instead.
import { existsSync } from "node:fs";

const offending = [".env.local", ".env.production.local", ".env.production", ".env"].filter((file) => existsSync(file));
if (offending.length && process.env.ALLOW_LOCAL_ENV_IN_BUILD !== "1") {
  console.error(`\n✖ Refusing to build for deployment: ${offending.join(", ")} would be bundled into the Worker.\n` +
    "  Deploy from CI (see .github/workflows/deploy-cloudflare.yml), or move the file aside temporarily.\n" +
    "  For a local-only preview that is never uploaded, use `npm run preview` (it sets ALLOW_LOCAL_ENV_IN_BUILD=1).\n");
  process.exit(1);
}
