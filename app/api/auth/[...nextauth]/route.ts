import NextAuth from "@/lib/auth";
import { withDatabaseTransaction } from "@/lib/db/database";

const handler = NextAuth;

export const GET = (request: Request, context: { params: Promise<{ nextauth: string[] }> }) =>
  withDatabaseTransaction(() => handler(request, context));

export const POST = (request: Request, context: { params: Promise<{ nextauth: string[] }> }) =>
  withDatabaseTransaction(() => handler(request, context));
