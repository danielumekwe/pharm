import NextAuth from "@/lib/auth";

// No outer database transaction: sign-in opens one for the chosen pharmacy, and the session callbacks open
// one for the token's pharmacy (lib/auth.ts).
const handler = NextAuth;

export const GET = (request: Request, context: { params: Promise<{ nextauth: string[] }> }) => handler(request, context);

export const POST = (request: Request, context: { params: Promise<{ nextauth: string[] }> }) => handler(request, context);
