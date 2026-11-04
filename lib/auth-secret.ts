// Shared by NextAuth and the proxy so both can decode the same JWT.
// Production must provide NEXTAUTH_SECRET (a Worker secret on Cloudflare). Falling back to a value that is
// visible in source code would let anyone forge sessions, so production fails closed instead.
const configured = process.env.NEXTAUTH_SECRET;
const building = process.env.NEXT_PHASE === "phase-production-build";

if (!configured && process.env.NODE_ENV === "production" && !building) {
  throw new Error("NEXTAUTH_SECRET is not set. Configure it as a secret (e.g. `wrangler secret put NEXTAUTH_SECRET`).");
}

export const AUTH_SECRET = configured ?? "local-development-only-insecure-secret";
